import { env, logger, paths } from "@synoro/config";
import {
  and,
  asc,
  type BillingPeriod,
  type Database,
  eq,
  gt,
  isNull,
  lte,
  SentNotice,
  Subscription,
  SubscriptionPayment,
  sql,
  user,
} from "@synoro/db";
import type { ProNotice, TemplateEmail } from "@synoro/emails";
import { PRO_PRICES } from "@synoro/validators";

import type { Deliver } from "./booking-video";
import { dispatchEmail } from "./index";

/**
 * Telling a specialist that their «Про» runs out: two weeks ahead when a paid
 * year ends, three days ahead and once it ended (the 14-day trial too).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SOON_MS = 14 * DAY_MS;
const ENDING_MS = 3 * DAY_MS;
/** «Про» that ended earlier than this is not announced any more. */
const ENDED_MS = 2 * DAY_MS;
const MAX_NOTICES = 200;
/** Longer than the workflow's 120-second execution timeout. */
const CLAIM_MS = 5 * 60 * 1000;
/** Specialists' time zone is unknown; the plan's dates are Moscow time. */
const TIME_ZONE = "Europe/Moscow";
/** Mails go out from 9:00 to 21:00 Moscow time. */
const DAY_HOURS = { from: 9, until: 21 };

export interface ProPlan {
  trialEndsAt: Date;
  paidUntil: Date | null;
  /** Period of the last successful payment, null if none. */
  lastPeriod: BillingPeriod | null;
}

/**
 * The notice due for `plan` at `now`, if any. The windows don't overlap, so
 * one end of «Про» gets each notice at most once whatever the timing.
 */
export function dueProNotice(plan: ProPlan, now: Date) {
  const paid = plan.paidUntil !== null && plan.paidUntil > plan.trialEndsAt;
  const endsAt = paid && plan.paidUntil ? plan.paidUntil : plan.trialEndsAt;
  const left = endsAt.getTime() - now.getTime();
  const year = paid && plan.lastPeriod === "year";

  let notice: ProNotice | undefined;
  if (left <= -ENDED_MS) notice = undefined;
  else if (left <= 0) notice = "ended";
  else if (left <= ENDING_MS) notice = "ending";
  else if (left <= SOON_MS && year) notice = "ending-soon";
  return notice ? { notice, endsAt, paid } : undefined;
}

function moscowHour(at: Date) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hour: "numeric",
      hourCycle: "h23",
    }).format(at),
  );
}

/** «20 ноября 2027», with the time unless it is midnight. */
function formatEnd(at: Date) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: TIME_ZONE,
      ...options,
    }).format(at);
  const date = `${part({ day: "numeric", month: "long" })} ${part({ year: "numeric" })}`;
  const time = part({ hour: "2-digit", minute: "2-digit" });
  return time === "00:00" ? date : `${date}, ${time}`;
}

function days(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} дня`;
  }
  return `${n} дней`;
}

function formatLeft(endsAt: Date, now: Date) {
  const left = endsAt.getTime() - now.getTime();
  if (left < DAY_MS) return "меньше чем через сутки";
  return `через ${days(Math.floor(left / DAY_MS))}`;
}

const rubles = (kopecks: number) => `${kopecks / 100} ₽`;

function billingUrl() {
  return new URL(paths.settings.billing, env.APP_URL).href;
}

/** Subscriptions whose «Про» ends (or ended) close to now, by id. */
function candidates(db: Database, now: Date, afterId: string | undefined) {
  const endsAt = sql`greatest(${Subscription.trialEndsAt}, coalesce(${Subscription.paidUntil}, ${Subscription.trialEndsAt}))`;
  return db
    .select({
      id: Subscription.id,
      userId: Subscription.userId,
      trialEndsAt: Subscription.trialEndsAt,
      paidUntil: Subscription.paidUntil,
      lastPeriod: sql<BillingPeriod | null>`(
        select ${SubscriptionPayment.period} from ${SubscriptionPayment}
        where ${SubscriptionPayment.userId} = ${Subscription.userId}
          and ${SubscriptionPayment.status} = 'succeeded'
        order by ${SubscriptionPayment.paidAt} desc nulls last
        limit 1
      )`,
      name: user.name,
      email: user.email,
    })
    .from(Subscription)
    .innerJoin(user, eq(user.id, Subscription.userId))
    .where(
      and(
        sql`${endsAt} > ${new Date(now.getTime() - ENDED_MS).toISOString()}::timestamptz`,
        sql`${endsAt} <= ${new Date(now.getTime() + SOON_MS).toISOString()}::timestamptz`,
        afterId ? gt(Subscription.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(Subscription.id))
    .limit(MAX_NOTICES);
}

/**
 * Mail every due «Про» notice once. Each notice is claimed in `sent_notices`
 * for five minutes and marked sent once the mail is handed over: a second
 * worker skips a live claim, a failed send gives the claim back, and a
 * crashed worker's claim expires for the next run (a crash right after
 * sending can repeat the mail). Outside Moscow daytime nothing is sent: the
 * windows are days long, the next run catches up.
 */
export async function sendProNotices(
  db: Database,
  deliver: Deliver = dispatchEmail,
  now = new Date(),
) {
  const hour = moscowHour(now);
  if (hour < DAY_HOURS.from || hour >= DAY_HOURS.until) return;

  const prices = `${rubles(PRO_PRICES.month.amount)} в месяц или ${rubles(PRO_PRICES.year.amount)} в год`;
  let afterId: string | undefined;
  while (true) {
    const rows = await candidates(db, now, afterId);

    for (const row of rows) {
      const due = dueProNotice(row, now);
      if (!due) continue;
      const key = `pro:${due.notice}:${row.userId}:${due.endsAt.toISOString()}`;
      const claimToken = crypto.randomUUID();
      const claimedAt = new Date();
      const claimExpiresAt = new Date(claimedAt.getTime() + CLAIM_MS);
      const claimed = await db
        .insert(SentNotice)
        .values({ key, userId: row.userId, claimToken, claimExpiresAt })
        .onConflictDoUpdate({
          target: SentNotice.key,
          set: { claimToken, claimExpiresAt },
          setWhere: and(
            isNull(SentNotice.sentAt),
            lte(SentNotice.claimExpiresAt, claimedAt),
          ),
        })
        .returning({ key: SentNotice.key });
      if (claimed.length === 0) continue;
      // A worker whose lease expired cannot release or finish a newer claim.
      const ownsClaim = and(
        eq(SentNotice.key, key),
        eq(SentNotice.claimToken, claimToken),
        isNull(SentNotice.sentAt),
      );

      const endsOn = formatEnd(due.endsAt);
      const left = formatLeft(due.endsAt, now);
      const subjects: Record<ProNotice, string> = {
        "ending-soon": `${due.paid ? "Оплаченный" : "Бесплатный"} период «Про» заканчивается ${endsOn}`,
        ending: `«Про» заканчивается ${left}`,
        ended: "«Про» закончился — продлите, чтобы принимать оплату онлайн",
      };
      try {
        const message: TemplateEmail = {
          template: "pro-notice",
          to: [row.email],
          subject: subjects[due.notice],
          props: {
            notice: due.notice,
            name: row.name,
            paid: due.paid,
            endsOn,
            left,
            prices,
            billingUrl: billingUrl(),
          },
        };
        await deliver(message);
      } catch (error) {
        await db.delete(SentNotice).where(ownsClaim);
        logger.warn("billing.pro_notice_failed", {
          userId: row.userId,
          notice: due.notice,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      await db
        .update(SentNotice)
        .set({ sentAt: new Date(), claimToken: null, claimExpiresAt: null })
        .where(ownsClaim);
    }

    const last = rows.at(-1);
    if (!last || rows.length < MAX_NOTICES) break;
    afterId = last.id;
  }
}
