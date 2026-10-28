import { and, asc, eq, PaymentAccount, PaymentPackage } from "@synoro/db";
import { z } from "zod";

import { canTakePayments, PROVIDER_NAMES } from "../../lib/payments";
import { publicProcedure } from "../../orpc";

/**
 * What a client can buy online at this practice. `enabled` is false when no
 * provider is connected (or the server can't use it): then clients pay the
 * administrator as before. Public: the booking page shows it before sign-in.
 *
 * @example client.payment.packages({ practiceId })
 */
export const packages = publicProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input }) => {
    const [account, rows] = await Promise.all([
      context.db.query.PaymentAccount.findFirst({
        where: and(
          eq(PaymentAccount.practiceId, input.practiceId),
          eq(PaymentAccount.active, true),
        ),
        columns: { provider: true, test: true, merchantId: true },
      }),
      context.db
        .select({
          id: PaymentPackage.id,
          credits: PaymentPackage.credits,
          price: PaymentPackage.price,
        })
        .from(PaymentPackage)
        .where(eq(PaymentPackage.practiceId, input.practiceId))
        .orderBy(asc(PaymentPackage.credits)),
    ]);

    const enabled = !!account && canTakePayments(account) && rows.length > 0;
    return {
      enabled,
      provider: account ? PROVIDER_NAMES[account.provider] : null,
      test: account?.test ?? false,
      packages: rows,
    };
  });
