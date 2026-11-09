import { and, eq, gt, isNull, lte, or, PracticeDomain } from "@synoro/db";
import { z } from "zod";

import {
  checkDomainDns,
  checkHttps,
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
 * DNS leads here, `https://<host>/` is tried too (through our entry point):
 * a trusted certificate and the page mark the domain `securedAt` (fully
 * ready); a later failed check clears it, so the console stops offering a
 * domain that doesn't open. The domain page calls this every few seconds
 * while it waits, so the owner watches the steps pass by.
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

    // Checks can overlap (this page, a second tab, the routes sync): what
    // started later and already wrote is newer, and this one doesn't undo it.
    const startedAt = new Date();
    const dns = await checkDomainDns(row.hostname, row.verificationToken);
    const owned = row.status === "active" || dns.ownership;
    // A certificate exists only for a host the cluster routes: an owned one
    // that leads here.
    const tls =
      owned && dns.routing && (await checkHttps(row.hostname, row.practiceId));
    const check = { ...dns, tls };
    const stage: DomainStage = !owned
      ? "ownership"
      : !dns.routing
        ? "routing"
        : !tls
          ? "certificate"
          : "ready";

    const now = new Date();
    const updated = await context.db
      .update(PracticeDomain)
      .set({
        lastCheckedAt: startedAt,
        ...(row.status === "pending" && dns.ownership
          ? { status: "active" as const, verifiedAt: now }
          : {}),
        // What works now: kept from the first success, gone once it fails.
        ...(owned ? { securedAt: tls ? (row.securedAt ?? now) : null } : {}),
      })
      .where(
        and(
          eq(PracticeDomain.id, row.id),
          eq(PracticeDomain.hostname, row.hostname),
          eq(PracticeDomain.verificationToken, row.verificationToken),
          eq(PracticeDomain.status, row.status),
          or(
            isNull(PracticeDomain.lastCheckedAt),
            lte(PracticeDomain.lastCheckedAt, startedAt),
          ),
          row.status === "pending"
            ? gt(
                PracticeDomain.createdAt,
                new Date(now.getTime() - DOMAIN_RESERVATION_MS),
              )
            : undefined,
        ),
      )
      .returning({ id: PracticeDomain.id });

    const settings = await domainSettings(context.db, input.practiceId);
    // The row changed meanwhile (replaced, expired, disconnected, or a newer
    // check wrote), before the update or after it: this check proved nothing
    // about the domain returned, so report where that one stands.
    const stored = settings.domain;
    const sameDomain =
      updated.length > 0 &&
      stored?.hostname === row.hostname &&
      stored.records.find((record) => record.purpose === "ownership")?.value ===
        row.verificationToken;
    return {
      ...settings,
      check,
      stage: sameDomain
        ? stage
        : stored?.securedAt
          ? ("ready" as const)
          : stored?.status === "active"
            ? ("routing" as const)
            : ("ownership" as const),
    };
  });
