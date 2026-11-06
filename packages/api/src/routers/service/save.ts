import { and, Booking, count, eq, Service, WaitlistEntry } from "@synoro/db";
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
 * one without is new. A service left out of the list is deleted, or archived
 * when bookings or waiting-list wishes still point at it, so the history and
 * the wishes stay whole; archived services leave the list and its limit.
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
        .where(
          and(
            eq(Service.practiceId, input.practiceId),
            eq(Service.archived, false),
          ),
        );
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
        const [booked] = await tx
          .select({ bookings: count() })
          .from(Booking)
          .where(eq(Booking.serviceId, id));
        const [waited] = await tx
          .select({ wishes: count() })
          .from(WaitlistEntry)
          .where(eq(WaitlistEntry.serviceId, id));
        if (booked?.bookings || waited?.wishes) {
          // History and wishes keep pointing at it, so it is archived, not
          // deleted: out of the editor and its limit, never offered again.
          await tx
            .update(Service)
            .set({
              active: false,
              archived: true,
              position: input.services.length + offset,
            })
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
      .where(
        and(
          eq(Service.practiceId, input.practiceId),
          eq(Service.archived, false),
        ),
      )
      .orderBy(Service.position, Service.createdAt);
    return { services };
  });
