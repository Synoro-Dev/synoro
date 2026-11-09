import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
  spyOn,
} from "bun:test";
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
    // Names are relative to the domain's zone: what the registrar's
    // «Имя» field expects, without the domain itself.
    expect(records.map((r) => r.name)).toEqual([
      "_booking-verification",
      "@",
      "@",
    ]);
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
    expect(settings.domain?.records.map((r) => r.name)).toEqual([
      "_booking-verification.zapis",
      "zapis",
    ]);
  });

  it("names records relative to the zone of a deeper subdomain", async () => {
    const other = await newPractice("deep-host");
    const settings = await connect(
      other.session,
      other.practiceId,
      "booking.stariva.ru",
    );
    expect(settings.domain?.zone).toBe("stariva.ru");
    expect(settings.domain?.records.map((r) => r.name)).toEqual([
      "_booking-verification.booking",
      "booking",
    ]);
  });

  it("takes the zone from the public suffix list, not the label count", async () => {
    const cases = [
      ["anna.co.uk", "anna.co.uk", ["_booking-verification", "@", "@"]],
      ["anna.msk.ru", "anna.msk.ru", ["_booking-verification", "@", "@"]],
      ["a.b.anna.com.au", "anna.com.au", ["_booking-verification.a.b", "a.b"]],
    ] as const;
    for (const [hostname, zone, names] of cases) {
      const other = await newPractice(`zone-${zone.replaceAll(".", "-")}`);
      const settings = await connect(other.session, other.practiceId, hostname);
      expect(settings.domain?.zone).toBe(zone);
      expect(settings.domain?.records.map((r) => r.name)).toEqual([...names]);
    }
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
      const https = spyOn(domains, "checkHttps").mockResolvedValue(true);
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
        if (change !== "none") {
          expect(result.domain?.lastCheckedAt).toBeNull();
          // Nothing was proved about the row as it is now: never «ready».
          expect(result.stage).toBe(
            change === "status" ? "routing" : "ownership",
          );
          expect(result.domain?.securedAt ?? null).toBeNull();
        } else {
          expect(result.stage).toBe("ready");
        }
      } finally {
        dns.mockRestore();
        https.mockRestore();
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
    const tlsSpy = spyOn(domains, "checkHttps").mockResolvedValue(tls);
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

    // A later failed check takes it back: the console offers the platform
    // address again, and the page resumes its steps.
    step = await verifyWith(
      own.session,
      own.practiceId,
      { ownership: false, routing: true },
      false,
    );
    expect(step.result.stage).toBe("certificate");
    expect(step.result.domain?.securedAt).toBeNull();
    expect((await mine(own.session))[0]?.siteDomain).toBeNull();

    step = await verifyWith(
      own.session,
      own.practiceId,
      { ownership: false, routing: true },
      true,
    );
    expect(step.result.stage).toBe("ready");

    // Another hostname starts over, its mark cleared: nothing is shown until
    // it is secured itself, even once its ownership is confirmed.
    const replaced = await connect(
      own.session,
      own.practiceId,
      "zapis.stages.ru",
    );
    expect(replaced.domain?.securedAt).toBeNull();
    await activate("zapis.stages.ru");
    expect((await mine(own.session))[0]?.siteDomain).toBeNull();
  });

  it("of two checks started in the same millisecond, the first to write wins", async () => {
    const own = await newPractice("stages-tie");
    await connect(own.session, own.practiceId, "tie.ru");
    await activate("tie.ru");
    const now = new Date("2030-06-01T12:00:00Z");
    // The other check started at the very same instant and wrote first.
    setSystemTime(now);
    const dns = spyOn(domains, "checkDomainDns").mockImplementationOnce(
      async () => {
        await api.db
          .update(PracticeDomain)
          .set({ securedAt: now, lastCheckedAt: now })
          .where(eq(PracticeDomain.practiceId, own.practiceId));
        return { ownership: true, routing: false };
      },
    );
    try {
      const result = await call(
        domainRouter.verify,
        { practiceId: own.practiceId },
        { context: api.context(own.session) },
      );
      expect(result.domain?.securedAt).toEqual(now);
      expect(result.stage).toBe("ready");
    } finally {
      dns.mockRestore();
      setSystemTime();
    }
  });

  it("a check overtaken by a newer one doesn't undo it", async () => {
    const own = await newPractice("stages-race");
    await connect(own.session, own.practiceId, "race.ru");
    await activate("race.ru");
    const secured = new Date("2030-01-01T00:00:00Z");
    // While this (failing) check runs, a newer one starts later and writes
    // first: the domain works.
    const dns = spyOn(domains, "checkDomainDns").mockImplementationOnce(
      async () => {
        await api.db
          .update(PracticeDomain)
          .set({ securedAt: secured, lastCheckedAt: new Date(Date.now() + 1) })
          .where(eq(PracticeDomain.practiceId, own.practiceId));
        return { ownership: true, routing: false };
      },
    );
    try {
      const result = await call(
        domainRouter.verify,
        { practiceId: own.practiceId },
        { context: api.context(own.session) },
      );
      expect(result.domain?.securedAt).toEqual(secured);
      expect(result.stage).toBe("ready");
    } finally {
      dns.mockRestore();
    }
  });
});

describe("checkDomainDns", () => {
  const targets = { cname: "domains.pages.test" };
  const resolver = (records: {
    txt?: string[][];
    cname?: string[];
    a?: Record<string, string[]>;
    aaaa?: Record<string, string[]>;
  }): DnsResolver => ({
    resolveTxt: async () => records.txt ?? [],
    resolveCname: async () => {
      if (!records.cname) throw new Error("ENODATA");
      return records.cname;
    },
    resolve4: async (host) => records.a?.[host] ?? [],
    resolve6: async (host) => records.aaaa?.[host] ?? [],
  });

  it("finds the token, even split into TXT chunks", async () => {
    let queried = "";
    const dns = resolver({ txt: [["other"], ["abc", "123"]] });
    const resolveTxt = dns.resolveTxt;
    dns.resolveTxt = async (name) => {
      queried = name;
      return resolveTxt(name);
    };
    const result = await checkDomainDns("anna.ru", "abc123", targets, dns);
    expect(result).toEqual({ ownership: true, routing: false });
    // The TXT lives under the connected host, whatever the UI shows.
    expect(queried).toBe("_booking-verification.anna.ru");
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

  it("an ALIAS counts only if every address, IPv6 too, is the target's", async () => {
    const check = (records: Parameters<typeof resolver>[0]) =>
      checkDomainDns("anna.ru", "t", targets, resolver(records));
    const target = { "domains.pages.test": ["198.51.100.7"] };
    const target6 = { "domains.pages.test": ["2001:db8::7"] };

    // One of ours and one foreign A record.
    expect(
      (
        await check({
          a: { "anna.ru": ["198.51.100.7", "203.0.113.10"], ...target },
        })
      ).routing,
    ).toBe(false);
    // Our A record, someone else's AAAA.
    expect(
      (
        await check({
          a: { "anna.ru": ["198.51.100.7"], ...target },
          aaaa: { "anna.ru": ["2001:db8::99"], ...target6 },
        })
      ).routing,
    ).toBe(false);
    expect(
      (
        await check({
          a: { "anna.ru": ["198.51.100.7"], ...target },
          aaaa: { "anna.ru": ["2001:db8::7"], ...target6 },
        })
      ).routing,
    ).toBe(true);
  });
});
