import { and, eq, Service, sql } from "@synoro/db";
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
 * one without is new. A service left out of the list is archived, never
 * deleted: a booking or a waiting-list wish may point at it (or be made while
 * this runs), and the history must stay whole. Archived services leave the
 * list and its limit and are never offered. Saves of one practice run one at
 * a time, so a stale save can't bring an archived service back. At least one
 * service stays on. Owner only.
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
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`services:${input.practiceId}`}))`,
      );
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
        await tx
          .update(Service)
          .set({
            active: false,
            archived: true,
            position: input.services.length + offset,
          })
          .where(eq(Service.id, id));
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
