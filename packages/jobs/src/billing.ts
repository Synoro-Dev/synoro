import {
  type AutorenewalCancelReason,
  and,
  type Database,
  eq,
  type PaymentStatus,
  SubscriptionAutorenewal,
  SubscriptionPayment,
  sql,
} from "@synoro/db";

/**
 * What the «Про» payment flow shares between the API (checkout, webhook,
 * refund) and the worker (`./billing-renewal`): `@synoro/api` already depends
 * on this package, so the code both need lives here.
 */

/**
 * Move a pending «Про» payment to its final status. Success marks it paid
 * and extends `subscriptions.paid_until` by its period in ONE statement:
 * the paid period starts when the current one ends (trial or an earlier
 * payment), or now if «Про» has lapsed. The rows are locked first, so racing
 * webhooks and status checks — or two payments of one user — never add a
 * period twice or lose one. A payment that carries the specialist's consent
 * to auto-renewal also (re)starts it in the same statement — unless a newer
 * agreement or a cancellation came after that consent. Settled payments
 * never change.
 */
export async function settleSubscriptionPayment(
  db: Database,
  paymentId: string,
  status: PaymentStatus,
) {
  if (status === "canceled") {
    await db.execute(sql`
      update subscription_payments
      set status = 'canceled', confirmation_url = null, updated_at = now()
      where id = ${paymentId} and status = 'pending'
    `);
  } else if (status === "succeeded") {
    await db.execute(sql`
      with target as (
        select sp.id, sp.user_id, sp.period,
          greatest(now(), s.trial_ends_at, coalesce(s.paid_until, now()))
            as period_start
        from subscription_payments sp
        join subscriptions s on s.user_id = sp.user_id
        where sp.id = ${paymentId} and sp.status = 'pending'
        for update of sp, s
      ), paid as (
        update subscription_payments sp
        set status = 'succeeded', paid_at = now(), confirmation_url = null,
            period_start = target.period_start,
            period_end = target.period_start + case target.period
              when 'year' then interval '1 year' else interval '1 month' end,
            updated_at = now()
        from target
        where sp.id = target.id
        returning sp.user_id, sp.period, sp.period_end, sp.external_id,
          sp.autorenew_consent_at
      ), renewal as (
        insert into subscription_autorenewals
          (user_id, external_id, period, consent_at)
        select user_id, external_id, period, autorenew_consent_at
        from paid
        where autorenew_consent_at is not null and external_id is not null
        on conflict (user_id) do update
        set external_id = excluded.external_id, period = excluded.period,
            status = 'active', consent_at = excluded.consent_at,
            failed_attempts = 0, last_attempt_at = null, canceled_at = null,
            cancel_reason = null, updated_at = now()
        -- A late confirmation of an older link must not undo a newer
        -- agreement or a cancellation made since: only a consent given
        -- after both replaces the card.
        where excluded.consent_at > subscription_autorenewals.consent_at
          and (subscription_autorenewals.canceled_at is null
            or excluded.consent_at > subscription_autorenewals.canceled_at)
      )
      update subscriptions s
      set paid_until = paid.period_end, updated_at = now()
      from paid
      where s.user_id = paid.user_id
    `);
  }

  const payment = await db.query.SubscriptionPayment.findFirst({
    where: eq(SubscriptionPayment.id, paymentId),
  });
  if (!payment) throw new Error(`Subscription payment ${paymentId} vanished`);
  return payment;
}

/**
 * Stop charging the user's card. Returns whether auto-renewal was on. The
 * bank-side subscription stays (the API can't cancel one without a schedule),
 * we just never charge it again.
 */
export async function cancelAutorenewal(
  db: Database,
  userId: string,
  reason: AutorenewalCancelReason,
) {
  const canceled = await db
    .update(SubscriptionAutorenewal)
    .set({ status: "canceled", canceledAt: new Date(), cancelReason: reason })
    .where(
      and(
        eq(SubscriptionAutorenewal.userId, userId),
        eq(SubscriptionAutorenewal.status, "active"),
      ),
    )
    .returning({ id: SubscriptionAutorenewal.id });
  return canceled.length > 0;
}
