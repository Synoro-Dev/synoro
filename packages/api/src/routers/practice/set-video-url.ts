import { eq, Practice } from "@synoro/db";
import { notifyVideoLinkChanged } from "@synoro/jobs/booking-video";
import { videoUrlSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findOwnerMembership,
  findPractice,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Set (or clear, with an empty string) the specialist's permanent video room.
 * Owner only. Clients of upcoming confirmed bookings that have no link of
 * their own are mailed the new one.
 *
 * @example client.practice.setVideoUrl({ practiceId, videoUrl: "https://acme.ktalk.ru/anna" })
 */
export const setVideoUrl = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Ссылку на видеовстречу задаёт владелец практики" },
  })
  .input(z.object({ practiceId: z.uuid(), videoUrl: videoUrlSchema }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    const practice =
      owner && (await findPractice(context.db, owner.practiceId));
    if (!owner || !practice) throw errors.FORBIDDEN();

    await context.db
      .update(Practice)
      .set({ videoUrl: input.videoUrl })
      .where(eq(Practice.id, practice.id));

    if (input.videoUrl !== practice.videoUrl) {
      await notifyVideoLinkChanged(context.db, { practiceId: practice.id });
    }
    return { videoUrl: input.videoUrl };
  });
