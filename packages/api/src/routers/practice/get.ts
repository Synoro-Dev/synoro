import { z } from "zod";
import {
  findMembership,
  findPractice,
  isStaff,
  practiceProcedure,
} from "../../lib/practice-access";
import { practiceImageUrl, publicBookingUrl } from "../../lib/urls";

/**
 * A practice the caller belongs to, with their membership.
 *
 * @example client.practice.get({ practiceId })
 */
export const get = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const member = await findMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    const practice =
      member && (await findPractice(context.db, member.practiceId));
    if (!member || !practice) throw errors.FORBIDDEN();

    const { image, videoUrl, ...info } = practice;
    return {
      ...info,
      /** The permanent video room: staff only, clients get it per booking. */
      videoUrl: isStaff(member.role) ? videoUrl : null,
      imageUrl: practiceImageUrl(practice.slug, image),
      /** The main address of the booking page, for sharing. */
      bookingUrl: publicBookingUrl(practice.slug),
      membership: { id: member.id, role: member.role, credits: member.credits },
    };
  });
