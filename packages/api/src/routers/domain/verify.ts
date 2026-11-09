import { and, eq, gt, PracticeDomain } from "@synoro/db";
import { z } from "zod";

import {
  checkCertificate,
  checkDomainDns,
  DOMAIN_RESERVATION_MS,
  type DomainStage,
  domainSettings,
} from "../../lib/domains";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Look up the domain's DNS now. The TXT record activates a pending domain;
 * `routing` only reports whether traffic reaches us yet. An active domain
 * stays active: if it stops pointing here, it simply gets no traffic. Once
 * DNS leads here, `https://<host>` is tried too: a trusted certificate marks
 * the domain `securedAt` (fully ready). The domain page calls this every few
 * seconds while it waits, so the owner watches the steps pass by.
 *
 * @example client.domain.verify({ practiceId })
 */
export const verify = ownerProcedure
  .errors({
    NOT_FOUND: { message: "Домен не подключён" },
    RESERVATION_EXPIRED: {
      message: "Срок проверки истёк — подключите домен заново",
    },
  })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const row = await context.db.query.PracticeDomain.findFirst({
      where: eq(PracticeDomain.practiceId, input.practiceId),
    });
    if (!row) throw errors.NOT_FOUND();
    // An expired reservation can't be activated (the UPDATE below requires a
    // live one), so say so instead of reporting a DNS miss.
    if (
      row.status === "pending" &&
      row.createdAt.getTime() <= Date.now() - DOMAIN_RESERVATION_MS
    ) {
      throw errors.RESERVATION_EXPIRED();
    }

    const dns = await checkDomainDns(row.hostname, row.verificationToken);
    const owned = row.status === "active" || dns.ownership;
    // A certificate exists only for a host the cluster routes: an owned one
    // that leads here (the probe is never sent anywhere else).
    const tls = owned && dns.routing && (await checkCertificate(row.hostname));
    const check = { ...dns, tls };
    const stage: DomainStage = !owned
      ? "ownership"
      : !dns.routing
        ? "routing"
        : !tls
          ? "certificate"
          : "ready";

    const now = new Date();
    await context.db
      .update(PracticeDomain)
      .set({
        lastCheckedAt: now,
        ...(row.status === "pending" && dns.ownership
          ? { status: "active" as const, verifiedAt: now }
          : {}),
        ...(tls && !row.securedAt ? { securedAt: now } : {}),
      })
      .where(
        and(
          eq(PracticeDomain.id, row.id),
          eq(PracticeDomain.hostname, row.hostname),
          eq(PracticeDomain.verificationToken, row.verificationToken),
          eq(PracticeDomain.status, row.status),
          row.status === "pending"
            ? gt(
                PracticeDomain.createdAt,
                new Date(now.getTime() - DOMAIN_RESERVATION_MS),
              )
            : undefined,
        ),
      );

    return {
      ...(await domainSettings(context.db, input.practiceId)),
      check,
      stage,
    };
  });
