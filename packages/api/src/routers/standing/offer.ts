import { z } from "zod";

import { hasPro } from "../../lib/billing";
import { findOpenPractice } from "../../lib/practice-access";
import { publicProcedure } from "../../orpc";

/**
 * Whether the booking page may offer «Закрепить это время» (a standing time):
 * a «Про» feature of the practice's owner.
 *
 * @example client.standing.offer({ practiceId })
 */
export const offer = publicProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input }) => {
    const practice = await findOpenPractice(context.db, input.practiceId);
    return {
      enabled: practice ? await hasPro(context.db, practice.ownerId) : false,
    };
  });
