import { asc, eq, PaymentPackage, Practice } from "@synoro/db";
import { z } from "zod";

import { PROVIDER_NAMES, payableAccount } from "../../lib/payments";
import { publicProcedure } from "../../orpc";

/**
 * What a client can buy online at this practice. `enabled` is false when no
 * provider is connected, the server can't use it, or the owner isn't on
 * «Про»: then clients pay the administrator as before. Public: the booking page shows it before sign-in.
 *
 * @example client.payment.packages({ practiceId })
 */
export const packages = publicProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input }) => {
    const practice = await context.db.query.Practice.findFirst({
      where: eq(Practice.id, input.practiceId),
      columns: { id: true, ownerId: true },
    });
    const [account, rows] = await Promise.all([
      practice ? payableAccount(context.db, practice) : undefined,
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

    const enabled = !!account && rows.length > 0;
    return {
      enabled,
      provider: account ? PROVIDER_NAMES[account.provider] : null,
      test: account?.test ?? false,
      packages: rows,
    };
  });
