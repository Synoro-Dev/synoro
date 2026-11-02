import { env, logger } from "@synoro/config";
import {
  and,
  asc,
  type Database,
  eq,
  gt,
  isNotNull,
  isNull,
  notLike,
  or,
  SubscriptionPayment,
  sql,
} from "@synoro/db";

import { claimNotice } from "./notice-claims";

/**
 * Yandex Direct is paid per annual customer (docs/direct.md): the first paid
 * year of a specialist who came from an ad goes back to Metrika as an offline
 * conversion, matched to the visit by the Direct click (`yclid`) or, failing
 * that, the Metrika visitor id. In Metrika the goal `paid_year` is a
 * JavaScript-event goal with the condition "matches"; Direct optimizes for it.
 *
 * Only the FIRST paid year counts: a later year (a renewal, auto-renewal
 * included) is the same customer, not a new one. Month payments, refunds,
 * the demo stand and Точка's sandbox never count.
 *
 * The bank settles payments in a webhook, long after the browser is gone, so
 * an hourly cron looks for them (`reportPaidYears`). A conversion goes out
 * once: each is claimed in `sent_notices` like a mail (`claimNotice`).
 */

export const PAID_YEAR_GOAL = "paid_year";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A payment is retried (after a failed upload) for this long. */
const RETRY_MS = 14 * DAY_MS;
const BATCH = 50;
const API = "https://api-metrika.yandex.net/management/v1/counter";

export interface Conversion {
  /** The Direct click, preferred: it ties the payment to the ad itself. */
  yclid: string | null;
  /** The Metrika visitor (`_ym_uid`), used when there is no `yclid`. */
  ymClientId: string | null;
  target: string;
  paidAt: Date;
  /** Kopecks, RUB. */
  amount: number;
}

/**
 * The upload file: a header and one row. Metrika reads the identifier's kind
 * from the column name. `DateTime` is Unix seconds and must be in the past.
 */
export function conversionCsv(conversion: Conversion) {
  const [idColumn, id] = conversion.yclid
    ? ["Yclid", conversion.yclid]
    : ["ClientId", conversion.ymClientId];
  if (!id) throw new Error("A conversion needs a yclid or a Metrika client id");
  const seconds = Math.floor(conversion.paidAt.getTime() / 1000);
  const price = (conversion.amount / 100).toFixed(2);
  return `${idColumn},Target,DateTime,Price,Currency\n${id},${conversion.target},${seconds},${price},RUB\n`;
}

/** Sends one conversion to the counter; throws when Metrika refuses it. */
async function uploadConversion(
  counterId: number,
  token: string,
  conversion: Conversion,
) {
  const body = new FormData();
  body.set(
    "file",
    new Blob([conversionCsv(conversion)], { type: "text/csv" }),
    "conversions.csv",
  );
  const response = await fetch(
    `${API}/${counterId}/offline_conversions/upload?comment=${conversion.target}`,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${token}` },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Metrika answered ${response.status}`);
  }
  const answer = (await response.json().catch(() => null)) as {
    uploading?: { id?: number; status?: string };
  } | null;
  return answer?.uploading;
}

/**
 * Paid years from the last two weeks that came from an ad and are the user's
 * first. Their claims in `sent_notices` decide which are still to be sent.
 */
function candidates(db: Database, now: Date) {
  return db
    .select({
      id: SubscriptionPayment.id,
      userId: SubscriptionPayment.userId,
      yclid: SubscriptionPayment.yclid,
      ymClientId: SubscriptionPayment.ymClientId,
      amount: SubscriptionPayment.amount,
      paidAt: SubscriptionPayment.paidAt,
    })
    .from(SubscriptionPayment)
    .where(
      and(
        eq(SubscriptionPayment.status, "succeeded"),
        eq(SubscriptionPayment.period, "year"),
        isNull(SubscriptionPayment.refundedAt),
        // An automatic charge is a renewal, never a new customer.
        isNull(SubscriptionPayment.chargedFor),
        gt(SubscriptionPayment.paidAt, new Date(now.getTime() - RETRY_MS)),
        or(
          isNotNull(SubscriptionPayment.yclid),
          isNotNull(SubscriptionPayment.ymClientId),
        ),
        // The demo stand and Точка's sandbox have no real money.
        notLike(SubscriptionPayment.externalId, "demo-%"),
        notLike(SubscriptionPayment.externalId, "sandbox-%"),
        sql`not exists (
          select 1 from subscription_payments earlier
          where earlier.user_id = ${SubscriptionPayment.userId}
            and earlier.period = 'year'
            and earlier.status = 'succeeded'
            and earlier.refunded_at is null
            and earlier.paid_at < ${SubscriptionPayment.paidAt}
        )`,
      ),
    )
    .orderBy(asc(SubscriptionPayment.paidAt))
    .limit(BATCH);
}

/**
 * Upload the conversions that are due. Does nothing without
 * METRIKA_COUNTER_ID and METRIKA_OAUTH_TOKEN. A failed upload gives its claim
 * back, so the next run tries again until the payment is two weeks old.
 */
export async function reportPaidYears(db: Database, now = new Date()) {
  const counterId = env.METRIKA_COUNTER_ID;
  const token = env.METRIKA_OAUTH_TOKEN;
  if (!counterId || !token) return { sent: 0 };

  let sent = 0;
  for (const payment of await candidates(db, now)) {
    if (!payment.paidAt) continue;
    const claim = await claimNotice(
      db,
      `metrika:${PAID_YEAR_GOAL}:${payment.id}`,
      payment.userId,
    );
    if (!claim) continue;

    try {
      const uploading = await uploadConversion(counterId, token, {
        yclid: payment.yclid,
        ymClientId: payment.ymClientId,
        target: PAID_YEAR_GOAL,
        paidAt: payment.paidAt,
        amount: payment.amount,
      });
      await claim.done();
      sent += 1;
      logger.info("metrika.conversion_sent", {
        paymentId: payment.id,
        uploadId: uploading?.id,
        by: payment.yclid ? "yclid" : "client_id",
      });
    } catch (error) {
      await claim.release();
      logger.warn("metrika.conversion_failed", {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent };
}
