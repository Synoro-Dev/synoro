import { logger } from "@synoro/config";
import type { Database } from "@synoro/db";

import { type Deliver, noticeSender } from "./messenger/deliver";
import { claimNotice } from "./notice-claims";

/**
 * Notices about a standing time («Про», `docs/standing-time.md`): the package
 * ran out and the next dates are held until the client pays, a hold is about
 * to run out, the standing time was paused. The texts are written by the API
 * (it knows the dates and the balance); this only claims `key` — the same
 * occasion is never mailed twice — and sends the mail through the client's
 * channel (`noticeSender`: Telegram or MAX when the owner has «Про», else
 * mail) with the plain `workflow-message` template.
 */
export async function sendStandingNotice(
  db: Database,
  notice: {
    /** The occasion: `standing:due:<id>:…`; claimed once. */
    key: string;
    userId: string;
    practiceId: string;
    practiceName: string;
    to: string;
    title: string;
    text: string;
  },
  deliver: Deliver = noticeSender(db),
) {
  const claim = await claimNotice(db, notice.key, notice.userId);
  if (!claim) return false;
  try {
    await deliver(
      {
        template: "workflow-message",
        to: [notice.to],
        subject: notice.title,
        props: {
          practiceName: notice.practiceName,
          title: notice.title,
          text: notice.text,
        },
      },
      { userId: notice.userId, practiceId: notice.practiceId },
    );
  } catch (error) {
    await claim.release();
    logger.warn("standing.notice_failed", {
      key: notice.key,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  await claim.done();
  return true;
}
