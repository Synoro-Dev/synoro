import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { env } from "@synoro/config";
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
    { name: "Практика", slug, profession: "other" },
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
  ({ session: owner, practiceId } = await newPractice("anna-i"));
});
afterAll(async () => {
  await api.close();
});

describe("domain.get", () => {
  it("shows the main address before any domain is connected", async () => {
    const settings = await call(
      domainRouter.get,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(settings.bookingUrl).toBe("http://localhost:3000/anna-i");
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
    const settings = await connect(
      owner,
      practiceId,
      "https://Anna-Ivanova.ru/",
    );
    expect(settings.domain?.hostname).toBe("anna-ivanova.ru");
    expect(settings.domain?.status).toBe("pending");

    const records = settings.domain?.records ?? [];
    expect(records.map((r) => [r.type, r.recommended])).toEqual([
      ["TXT", true],
      ["CNAME", false],
      ["ALIAS", true],
    ]);
    expect(records[0]?.name).toBe("_booking-verification.anna-ivanova.ru");
    // Names only: no address is ever shown to connect a domain.
    for (const record of records.filter((r) => r.purpose === "routing")) {
      expect(record.value).toBe("domains.pages.test");
    }
  });

  it("a subdomain gets a CNAME and nothing else to route", async () => {
    const other = await newPractice("zapis-host");
    const settings = await connect(
      other.session,
      other.practiceId,
      "zapis.anna-psy.ru",
    );
    expect(
      settings.domain?.records.map((r) => [r.type, r.recommended]),
    ).toEqual([
      ["TXT", true],
      ["CNAME", true],
    ]);
  });

  it("keeps the token when the same host is submitted again", async () => {
    const before = await connect(owner, practiceId, "anna-ivanova.ru");
    const again = await connect(owner, practiceId, "ANNA-IVANOVA.RU");
    expect(again.domain?.records[0]?.value).toBe(
      before.domain?.records[0]?.value as string,
    );
  });

  it("refuses the platform's own hosts", async () => {
    const error = await connect(owner, practiceId, "boris.localhost").catch(
      (e: unknown) => e,
    );
    expect(isDefinedError(error) && error.code).toBe("PLATFORM_DOMAIN");
  });

  it("refuses the main booking address and hosts under it", async () => {
    const mutable = env as { BOOKING_URL?: string };
    const saved = mutable.BOOKING_URL;
    mutable.BOOKING_URL = "https://booking.example";
    try {
      for (const host of ["booking.example", "boris.booking.example"]) {
        const error = await connect(owner, practiceId, host).catch(
          (e: unknown) => e,
        );
        expect(isDefinedError(error) && error.code).toBe("PLATFORM_DOMAIN");
      }
    } finally {
      mutable.BOOKING_URL = saved;
    }
  });

  it("refuses a host another practice has", async () => {
    const other = await newPractice("boris");
    const error = await connect(
      other.session,
      other.practiceId,
      "anna-ivanova.ru",
    ).catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("CONFLICT");
  });
});

describe("practice.byHost", () => {
  it("does not serve a domain until it is verified", async () => {
    const error = await byHost("anna-ivanova.ru").catch((e: unknown) => e);
    expect(isDefinedError(error) && error.code).toBe("NOT_FOUND");

    await activate("anna-ivanova.ru");
    const practice = await byHost("Anna-Ivanova.ru:443");
    expect(practice.id).toBe(practiceId);
    expect(practice.membership).toBeNull();
  });

  it("returns NOT_FOUND for a slug as a subdomain and unknown hosts", async () => {
    for (const host of ["anna-i.synoro.ru", "anna-i", "nope.ru"]) {
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
    const error = await byHost("anna-ivanova.ru").catch((e: unknown) => e);
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

  it("reports an expired reservation without a DNS lookup", async () => {
    const own = await newPractice("verify-stale");
    await connect(own.session, own.practiceId, "verify-stale.ru");
    await api.db
      .update(PracticeDomain)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(PracticeDomain.practiceId, own.practiceId));
    const dns = spyOn(domains, "checkDomainDns");
    try {
      const error = await call(
        domainRouter.verify,
        { practiceId: own.practiceId },
        { context: api.context(own.session) },
      ).catch((e: unknown) => e);
      expect(isDefinedError(error) && error.code).toBe("RESERVATION_EXPIRED");
      expect(dns).not.toHaveBeenCalled();
    } finally {
      dns.mockRestore();
    }
  });
});

describe("domain.verify stages", () => {
  async function verifyWith(
    session: Session,
    id: string,
    dns: { ownership: boolean; routing: boolean },
    tls: boolean,
  ) {
    const dnsSpy = spyOn(domains, "checkDomainDns").mockResolvedValue(dns);
    const tlsSpy = spyOn(domains, "checkCertificate").mockResolvedValue(tls);
    try {
      const result = await call(
        domainRouter.verify,
        { practiceId: id },
        { context: api.context(session) },
      );
      return { result, probed: tlsSpy.mock.calls.length > 0 };
    } finally {
      dnsSpy.mockRestore();
      tlsSpy.mockRestore();
    }
  }

  const mine = (session: Session) =>
    call(practiceRouter.mine, undefined, { context: api.context(session) });

  it("walks TXT → DNS → certificate → ready, then shows the domain", async () => {
    const own = await newPractice("stages");
    await connect(own.session, own.practiceId, "stages.ru");

    // No TXT yet: the certificate is never probed.
    let step = await verifyWith(
      own.session,
      own.practiceId,
      { ownership: false, routing: true },
      true,
    );
    expect(step.result.stage).toBe("ownership");
    expect(step.probed).toBe(false);

    step = await verifyWith(
      own.session,
      own.practiceId,
      { ownership: true, routing: false },
      true,
    );
    expect(step.result.stage).toBe("routing");
    expect(step.result.domain?.status).toBe("active");
    expect(step.probed).toBe(false);

    step = await verifyWith(
      own.session,
      own.practiceId,
      { ownership: false, routing: true },
      false,
    );
    expect(step.result.stage).toBe("certificate");
    expect(step.result.domain?.securedAt).toBeNull();
    const [before] = await mine(own.session);
    expect(before?.siteDomain).toBeNull();

    step = await verifyWith(
      own.session,
      own.practiceId,
      { ownership: false, routing: true },
      true,
    );
    expect(step.result.stage).toBe("ready");
    expect(step.result.check.tls).toBe(true);
    expect(step.result.domain?.securedAt).toBeInstanceOf(Date);

    const [after] = await mine(own.session);
    expect(after?.siteDomain).toEqual({
      hostname: "stages.ru",
      url: "https://stages.ru",
    });
    const practice = await call(
      practiceRouter.get,
      { practiceId: own.practiceId },
      { context: api.context(own.session) },
    );
    expect(practice.siteDomain?.url).toBe("https://stages.ru");

    // Another hostname starts over: nothing is shown until it is secured.
    await connect(own.session, own.practiceId, "zapis.stages.ru");
    const [replaced] = await mine(own.session);
    expect(replaced?.siteDomain).toBeNull();
  });
});

describe("checkDomainDns", () => {
  const targets = { cname: "domains.pages.test" };
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

  it("accepts a CNAME to the target, or an ALIAS (the target's addresses)", async () => {
    const check = (records: Parameters<typeof resolver>[0]) =>
      checkDomainDns("anna.ru", "t", targets, resolver(records));

    expect((await check({ cname: ["Domains.Pages.Test."] })).routing).toBe(
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
    // A bare address that merely happens to be ours is not enough: nothing
    // pins the hosting's IP any more.
    expect(
      (
        await check({
          a: { "anna.ru": ["203.0.113.10"], "domains.pages.test": [] },
        })
      ).routing,
    ).toBe(false);
    expect((await check({ a: { "anna.ru": ["192.0.2.1"] } })).routing).toBe(
      false,
    );
  });
});
