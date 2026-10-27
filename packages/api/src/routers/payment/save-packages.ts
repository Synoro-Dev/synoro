import { and, eq, notInArray, PaymentPackage } from "@synoro/db";
import { paymentPackagesFormSchema } from "@synoro/validators";
import { z } from "zod";

import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Replace the practice's price list. A package is identified by its size,
 * so changing a price keeps the row; sizes no longer listed are removed
 * (payments already started keep their own amount).
 *
 * @example client.payment.savePackages({ practiceId, packages: [{ credits: 1, price: 300_000 }, { credits: 5, price: 1_400_000 }] })
 */
export const savePackages = ownerProcedure
  .input(paymentPackagesFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const sizes = input.packages.map((p) => p.credits);
    await context.db
      .delete(PaymentPackage)
      .where(
        and(
          eq(PaymentPackage.practiceId, input.practiceId),
          sizes.length ? notInArray(PaymentPackage.credits, sizes) : undefined,
        ),
      );

    for (const pkg of input.packages) {
      await context.db
        .insert(PaymentPackage)
        .values({ practiceId: input.practiceId, ...pkg })
        .onConflictDoUpdate({
          target: [PaymentPackage.practiceId, PaymentPackage.credits],
          set: { price: pkg.price },
        });
    }

    return { count: input.packages.length };
  });
