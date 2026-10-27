import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { eq, PracticeDomain } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import * as domains from "../../lib/domains";
import { checkDomainDns, type DnsResolver } from "../../lib/domains";
import { practiceRouter } from "../practice";
import { domainRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;

async function newPractice(slug: string) {
  const session = await createSession(api.db);
  const practice = await call(
    practiceRouter.create,
    { name: "Практика", slug },
    { context: api.context(session) },
  );
  return { session, practiceId: practice.id };
}

function connect(session: Session, id: string, hostname: string) {
  return call(
    domainRouter.connect,
    { practiceId: id, hostname },
    { context: api.context(session) },
  );
}

function byHost(host: string) {
  return call(practiceRouter.byHost, { host }, { context: api.context() });
}

async function activate(hostname: string) {
  await api.db
    .update(PracticeDomain)
    .set({ status: "active", verifiedAt: new Date() })
    .where(eq(PracticeDomain.hostname, hostname));
}

beforeAll(async () => {
  api = await setupTestApi();
  ({ session: owner, practiceId } = await newPractice("anna"));
});
afterAll(async () => {
  await api.close();
});

describe("domain.get", () => {
  it("shows the platform subdomain before any domain is connected", async () => {
    const settings = await call(
      domainRouter.get,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(settings.platformUrl).toBe("http://anna.pages.test:3000");
    expect(settings.targetsConfigured).toBe(true);
    expect(settings.domain).toBeNull();
  });

  it("is owner-only", async () => {
    const stranger = await createSession(api.db);
    const error = await call(
      domainRouter.get,
      { practiceId },
      { context: api.context(stranger) },
    ).catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("FORBIDDEN");
  });
});

describe("domain.connect", () => {
  it("normalizes the host and lists the DNS records to add", async () => {
    const settings = await connect(owner, practiceId, "https://Anna-Psy.ru/");
    expect(settings.domain?.hostname).toBe("anna-psy.ru");
    expect(settings.domain?.status).toBe("pending");

    const records = settings.domain?.records ?? [];
    expect(records.map((r) => [r.type, r.recommended])).toEqual([
      ["TXT", true],
      ["CNAME", false],
      ["A", true],
    ]);
    expect(records[0]?.name).toBe("_booking-verification.anna-psy.ru");
  });

  it("keeps the token when the same host is submitted again", async () => {
    const before = await connect(owner, practiceId, "anna-psy.ru");
    const again = await connect(owner, practiceId, "ANNA-PSY.RU");
    expect(again.domain?.records[0]?.value).toBe(
      before.domain?.records[0]?.value as string,
    );
  });

  it("refuses the platform's own hosts", async () => {
    for (const host of ["boris.pages.test", "pages.test"]) {
      const error = await connect(owner, practiceId, host).catch(
        (e: unknown) => e,
      );
      expect(isDefinedError(error) && error.code).toBe("PLATFORM_DOMAIN");
    }
  });

  it("refuses a host another practice has", async () => {
    const other = await newPractice("boris");
    const error = await connect(
      other.session,
      other.practiceId,
      "anna-psy.ru",
    ).catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("CONFLICT");
  });
});

describe("practice.byHost", () => {
  it("serves platform subdomains by slug", async () => {
    const practice = await byHost("anna.pages.test");
    expect(practice.id).toBe(practiceId);
    expect(practice.membership).toBeNull();
  });

  it("does not serve a domain until it is verified", async () => {
    const error = await byHost("anna-psy.ru").catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("NOT_FOUND");

    await activate("anna-psy.ru");
    expect((await byHost("Anna-Psy.ru:443")).id).toBe(practiceId);
  });

  it("returns NOT_FOUND for reserved, nested and unknown hosts", async () => {
    for (const host of ["www.pages.test", "a.anna.pages.test", "nope.ru"]) {
      const error = await byHost(host).catch((e: unknown) => e);
      expect(isDefinedError(error) && error.code).toBe("NOT_FOUND");
    }
  });
});

describe("domain.disconnect", () => {
  it("stops serving the domain", async () => {
    const settings = await call(
      domainRouter.disconnect,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(settings.domain).toBeNull();
    const error = await byHost("anna-psy.ru").catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("NOT_FOUND");
  });
});

describe("domain reservation expiry", () => {
  const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

  it("reclaims an expired pending host with a fresh token", async () => {
    const first = await newPractice("expired-first");
    const next = await newPractice("expired-next");
    const before = await connect(first.session, first.practiceId, "expired.ru");
    await api.db
      .update(PracticeDomain)
      .set({ createdAt: expiredAt })
      .where(eq(PracticeDomain.practiceId, first.practiceId));
    const after = await connect(next.session, next.practiceId, "expired.ru");
    expect(after.domain?.status).toBe("pending");
    expect(after.domain?.records[0]?.value).not.toBe(
      before.domain?.records[0]?.value,
    );
    expect(
      await api.db.query.PracticeDomain.findFirst({
        where: eq(PracticeDomain.practiceId, first.practiceId),
      }),
    ).toBeUndefined();
  });

  it("renews an owner's expired reservation and resets time on replacement", async () => {
    const own = await newPractice("expired-own");
    const before = await connect(own.session, own.practiceId, "renew.ru");
    const age = () =>
      api.db
        .update(PracticeDomain)
        .set({ createdAt: expiredAt })
        .where(eq(PracticeDomain.practiceId, own.practiceId));
    await age();
    const renewed = await connect(own.session, own.practiceId, "renew.ru");
    expect(renewed.domain?.records[0]?.value).not.toBe(
      before.domain?.records[0]?.value,
    );
    await age();
    await connect(own.session, own.practiceId, "replacement.ru");
    const row = await api.db.query.PracticeDomain.findFirst({
      where: eq(PracticeDomain.practiceId, own.practiceId),
    });
    expect(row?.createdAt.getTime()).toBeGreaterThan(expiredAt.getTime());
  });

  it("never reclaims an active host, regardless of its age", async () => {
    const first = await newPractice("active-first");
    const next = await newPractice("active-next");
    const before = await connect(first.session, first.practiceId, "active.ru");
    await activate("active.ru");
    await api.db
      .update(PracticeDomain)
      .set({ createdAt: expiredAt })
      .where(eq(PracticeDomain.practiceId, first.practiceId));
    const error = await connect(
      next.session,
      next.practiceId,
      "active.ru",
    ).catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("CONFLICT");
    const own = await connect(first.session, first.practiceId, "active.ru");
    expect(own.domain?.status).toBe("active");
    expect(own.domain?.records[0]?.value).toBe(
      before.domain?.records[0]?.value,
    );
  });
});

describe("domain.verify", () => {
  for (const change of [
    "none",
    "hostname",
    "token",
    "status",
    "expired",
    "recreated",
  ] as const) {
    it(`activates only the checked pending reservation: ${change}`, async () => {
      const own = await newPractice(`verify-${change}`);
      const hostname = `verify-${change}.ru`;
      await connect(own.session, own.practiceId, hostname);
      const verifiedAt = new Date("2025-01-01T00:00:00Z");
      const dns = spyOn(domains, "checkDomainDns").mockImplementationOnce(
        async () => {
          if (change === "recreated") {
            await api.db
              .delete(PracticeDomain)
              .where(eq(PracticeDomain.practiceId, own.practiceId));
            await connect(own.session, own.practiceId, hostname);
          } else if (change !== "none") {
            await api.db
              .update(PracticeDomain)
              .set(
                change === "hostname"
                  ? { hostname: "changed.ru" }
                  : change === "token"
                    ? { verificationToken: "changed" }
                    : change === "status"
                      ? { status: "active", verifiedAt }
                      : {
                          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
                        },
              )
              .where(eq(PracticeDomain.practiceId, own.practiceId));
          }
          return { ownership: true, routing: true };
        },
      );
      try {
        const result = await call(
          domainRouter.verify,
          { practiceId: own.practiceId },
          { context: api.context(own.session) },
        );
        expect(dns).toHaveBeenCalledTimes(1);
        expect(result.domain?.status).toBe(
          change === "none" || change === "status" ? "active" : "pending",
        );
        if (change === "status")
          expect(result.domain?.verifiedAt).toEqual(verifiedAt);
        if (change !== "none") expect(result.domain?.lastCheckedAt).toBeNull();
      } finally {
        dns.mockRestore();
      }
    });
  }
});

describe("checkDomainDns", () => {
  const targets = { cname: "domains.pages.test", ip: "203.0.113.10" };
  const resolver = (records: {
    txt?: string[][];
    cname?: string[];
    a?: Record<string, string[]>;
  }): DnsResolver => ({
    resolveTxt: async () => records.txt ?? [],
    resolveCname: async () => {
      if (!records.cname) throw new Error("ENODATA");
      return records.cname;
    },
    resolve4: async (host) => records.a?.[host] ?? [],
  });

  it("finds the token, even split into TXT chunks", async () => {
    const result = await checkDomainDns(
      "anna.ru",
      "abc123",
      targets,
      resolver({ txt: [["other"], ["abc", "123"]] }),
    );
    expect(result).toEqual({ ownership: true, routing: false });
  });

  it("accepts a CNAME to the target, an A record, or flattened CNAME", async () => {
    const check = (records: Parameters<typeof resolver>[0]) =>
      checkDomainDns("anna.ru", "t", targets, resolver(records));

    expect((await check({ cname: ["Domains.Pages.Test."] })).routing).toBe(
      true,
    );
    expect((await check({ a: { "anna.ru": ["203.0.113.10"] } })).routing).toBe(
      true,
    );
    expect(
      (
        await check({
          a: {
            "anna.ru": ["198.51.100.7"],
            "domains.pages.test": ["198.51.100.7"],
          },
        })
      ).routing,
    ).toBe(true);
    expect((await check({ a: { "anna.ru": ["192.0.2.1"] } })).routing).toBe(
      false,
    );
  });
});
