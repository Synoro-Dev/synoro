import { and, Booking, count, eq, Service } from "@synoro/db";
import { servicesFormSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { OWNER_ONLY } from "./owner";

/**
 * Replace the practice's services, in the order given. A service with an `id`
 * is changed in place — bookings made earlier keep what they were charged —
 * one without is new. A service left out of the list is deleted, or only
 * switched off when bookings still point at it, so the history stays whole.
 * At least one service stays on. Owner only.
 *
 * @example client.service.save({ practiceId, services: [{ name: "Консультация", minutes: 60, credits: 1, active: true }] })
 */
export const save = practiceProcedure
  .errors({ FORBIDDEN: { message: OWNER_ONLY } })
  .input(servicesFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    await context.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: Service.id })
        .from(Service)
        .where(eq(Service.practiceId, input.practiceId));
      const known = new Set(existing.map((s) => s.id));
      const kept = new Set<string>();

      for (const [position, service] of input.services.entries()) {
        const values = {
          name: service.name,
          minutes: service.minutes,
          credits: service.credits,
          active: service.active,
          position,
        };
        if (service.id && known.has(service.id)) {
          kept.add(service.id);
          await tx
            .update(Service)
            .set(values)
            .where(
              and(
                eq(Service.id, service.id),
                eq(Service.practiceId, input.practiceId),
              ),
            );
        } else {
          await tx
            .insert(Service)
            .values({ practiceId: input.practiceId, ...values });
        }
      }

      for (const [offset, { id }] of existing
        .filter((s) => !kept.has(s.id))
        .entries()) {
        const [used] = await tx
          .select({ bookings: count() })
          .from(Booking)
          .where(eq(Booking.serviceId, id));
        if (used?.bookings) {
          await tx
            .update(Service)
            .set({ active: false, position: input.services.length + offset })
            .where(eq(Service.id, id));
        } else {
          await tx.delete(Service).where(eq(Service.id, id));
        }
      }
    });

    const services = await context.db
      .select({
        id: Service.id,
        name: Service.name,
        minutes: Service.minutes,
        credits: Service.credits,
        active: Service.active,
      })
      .from(Service)
      .where(eq(Service.practiceId, input.practiceId))
      .orderBy(Service.position, Service.createdAt);
    return { services };
  });
