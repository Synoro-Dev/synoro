import { describe, expect, test } from "bun:test";

import {
  hostOfRoute,
  ingressRoute,
  planReadiness,
  planRoutes,
  reachesUs,
  routeName,
} from "./custom-domains";

const target = { service: "synoro-app", port: "http", certResolver: "le" };
const targets = { cname: "domains.synoro.ru" };

/** Which of the hosts the plan turns away, whatever DNS says. */
const refused = async (hosts: string[], ownHosts: string[] = []) =>
  (
    await planRoutes({
      active: hosts,
      existing: [],
      ownHosts,
      reaches: async () => true,
    })
  ).refused;

describe("hostnames", () => {
  test("plain lowercase hostnames pass, punycode included", async () => {
    expect(
      await refused(["anna.ru", "zapis.anna-psy.ru", "xn--80aa2ba.xn--p1ai"]),
    ).toEqual([]);
  });

  test("anything that could leave the rule or the name is refused", async () => {
    const odd = [
      "",
      "anna",
      "Anna.ru",
      "anna.ru`) || Host(`synoro.ru",
      "anna.ru/path",
      "anna.ru:443",
      "-anna.ru",
      "anna..ru",
      "*.anna.ru",
      `${"a".repeat(64)}.ru`,
      `${"a.".repeat(130)}ru`,
    ];
    expect(await refused(odd)).toEqual(odd);
  });

  test("the platform's hosts and everything under them are refused", async () => {
    const own = ["synoro.ru", "app.synoro.ru"];
    expect(
      await refused(
        ["synoro.ru", "anna.synoro.ru", "notsynoro.ru", "synoro.ru.evil.com"],
        own,
      ),
    ).toEqual(["synoro.ru", "anna.synoro.ru"]);
  });
});

describe("ingressRoute", () => {
  test("one host, one certificate, only the managed label", () => {
    const route = ingressRoute("anna.ru", target);
    expect(route.metadata.name).toBe("cd-anna.ru");
    expect(hostOfRoute(route.metadata.name)).toBe("anna.ru");
    expect(route.metadata.labels["app.kubernetes.io/managed-by"]).toBe(
      "synoro-domains-sync",
    );
    expect(route.spec.entryPoints).toEqual(["websecure"]);
    expect(route.spec.routes).toHaveLength(1);
    expect(route.spec.routes[0]?.match).toBe("Host(`anna.ru`)");
    expect(route.spec.tls.certResolver).toBe("le");
  });

  test("a route name maps back to its host", () => {
    expect(routeName("zapis.anna.ru")).toBe("cd-zapis.anna.ru");
    expect(hostOfRoute("synoro-app")).toBeUndefined();
  });
});

describe("reachesUs", () => {
  const resolver = (
    records: Record<
      string,
      { cname?: string[]; a?: string[]; aaaa?: string[] }
    >,
  ) => ({
    resolveCname: async (host: string) => records[host]?.cname ?? [],
    resolve4: async (host: string) => records[host]?.a ?? [],
    resolve6: async (host: string) => records[host]?.aaaa ?? [],
  });

  test("a CNAME to the target, or the target's own addresses", async () => {
    const dns = resolver({
      "domains.synoro.ru": { a: ["203.0.113.10"] },
      "zapis.a.ru": { cname: ["Domains.Synoro.ru."] },
      "b.ru": { a: ["203.0.113.10"] },
      "c.ru": { a: ["198.51.100.7"] },
    });
    expect(await reachesUs("zapis.a.ru", targets, dns)).toBe(true);
    // An ALIAS at the apex answers with the target's addresses.
    expect(await reachesUs("b.ru", targets, dns)).toBe(true);
    expect(await reachesUs("c.ru", targets, dns)).toBe(false);
    expect(await reachesUs("nowhere.ru", targets, dns)).toBe(false);
  });

  test("follows the target to a new address, none is configured here", async () => {
    const moved = resolver({
      "domains.synoro.ru": { a: ["192.0.2.55"] },
      "b.ru": { a: ["192.0.2.55"] },
    });
    expect(await reachesUs("b.ru", targets, moved)).toBe(true);
  });

  test("flattened apex: same addresses as the CNAME target", async () => {
    const dns = resolver({
      "domains.synoro.ru": { a: ["198.51.100.9"] },
      "a.ru": { a: ["198.51.100.9"] },
    });
    expect(await reachesUs("a.ru", { cname: "domains.synoro.ru" }, dns)).toBe(
      true,
    );
  });

  test("every address must be ours: one foreign A or AAAA is not enough", async () => {
    const dns = resolver({
      "domains.synoro.ru": { a: ["203.0.113.10"], aaaa: ["2001:db8::10"] },
      "both.ru": { a: ["203.0.113.10"], aaaa: ["2001:db8::10"] },
      "mixed-a.ru": { a: ["203.0.113.10", "198.51.100.7"] },
      "foreign-v6.ru": { a: ["203.0.113.10"], aaaa: ["2001:db8::99"] },
      "v6-only.ru": { aaaa: ["2001:db8::10"] },
    });
    expect(await reachesUs("both.ru", targets, dns)).toBe(true);
    expect(await reachesUs("v6-only.ru", targets, dns)).toBe(true);
    expect(await reachesUs("mixed-a.ru", targets, dns)).toBe(false);
    expect(await reachesUs("foreign-v6.ru", targets, dns)).toBe(false);
  });

  test("nothing configured, nothing reaches us", async () => {
    expect(
      await reachesUs("a.ru", {}, resolver({ "a.ru": { a: ["1.1.1.1"] } })),
    ).toBe(false);
  });
});

describe("planRoutes", () => {
  const own = ["synoro.ru"];
  const plan = (
    active: string[],
    existing: string[],
    reaching: string[] = [],
  ) =>
    planRoutes({
      active,
      existing,
      ownHosts: own,
      reaches: async (host) => reaching.includes(host),
    });

  test("a new host gets a route once its DNS leads here", async () => {
    expect(await plan(["a.ru", "b.ru"], [], ["a.ru"])).toEqual({
      apply: ["a.ru"],
      remove: [],
      waiting: ["b.ru"],
      refused: [],
    });
  });

  test("an existing route stays through a DNS blip", async () => {
    const result = await plan(["a.ru"], ["a.ru"], []);
    expect(result.apply).toEqual(["a.ru"]);
    expect(result.remove).toEqual([]);
  });

  test("a disconnected host loses its route", async () => {
    expect((await plan([], ["a.ru"])).remove).toEqual(["a.ru"]);
  });

  test("the platform's own hosts and odd names are refused, routes dropped", async () => {
    const result = await plan(
      ["synoro.ru", "x.synoro.ru", "a`b.ru", "ok.ru"],
      ["x.synoro.ru"],
      ["ok.ru"],
    );
    expect(result.refused).toEqual(["synoro.ru", "x.synoro.ru", "a`b.ru"]);
    expect(result.apply).toEqual(["ok.ru"]);
    expect(result.remove).toEqual(["x.synoro.ru"]);
  });

  test("a duplicate row is one route", async () => {
    expect((await plan(["a.ru", "a.ru"], [], ["a.ru"])).apply).toEqual([
      "a.ru",
    ]);
  });
});

describe("planReadiness", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const hosts = (domains: { hostname: string }[]) =>
    domains.map((d) => d.hostname);
  const domain = (hostname: string, securedAt: Date | null = null) => ({
    hostname,
    practiceId: `practice-of-${hostname}`,
    securedAt,
  });
  const plan = (
    domains: ReturnType<typeof domain>[],
    options: {
      routed?: string[];
      via?: string;
      reaching?: string[];
      serving?: string[];
    } = {},
  ) => {
    const all = domains.map((d) => d.hostname);
    const { routed = all, reaching = all, serving = all } = options;
    // An explicit `via: undefined` is the no-target case, not the default.
    const via = "via" in options ? options.via : "domains.synoro.ru";
    const probed: [string, string, string][] = [];
    return planReadiness({
      domains,
      routed: new Set(routed),
      via,
      reaches: async (host) => reaching.includes(host),
      probe: async (host, through, practiceId) => {
        probed.push([host, through, practiceId]);
        return serving.includes(host);
      },
    }).then((result) => ({ ...result, probed }));
  };

  test("marks a routed host that leads here and serves its practice", async () => {
    const anna = domain("anna.ru");
    const result = await plan([anna]);
    // The checked record itself, for the caller to update exactly that one.
    expect(result.secure).toEqual([anna]);
    expect(result.unsecure).toEqual([]);
    expect(result.probed).toEqual([
      ["anna.ru", "domains.synoro.ru", "practice-of-anna.ru"],
    ]);
  });

  test("checks a few domains at a time, all of them in the end", async () => {
    const domains = Array.from({ length: 20 }, (_, i) => domain(`d${i}.ru`));
    let running = 0;
    let most = 0;
    const result = await planReadiness({
      domains,
      routed: new Set(domains.map((d) => d.hostname)),
      via: "domains.synoro.ru",
      reaches: async () => true,
      probe: async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return true;
      },
      concurrency: 3,
    });
    expect(most).toBe(3);
    expect(result.secure).toHaveLength(20);
  });

  test("an existing route whose DNS moved away is not ready", async () => {
    // The route stays through a DNS change (planRoutes), readiness doesn't.
    const result = await plan([domain("anna.ru", at)], { reaching: [] });
    expect(hosts(result.unsecure)).toEqual(["anna.ru"]);
    expect(result.probed).toEqual([]);
  });

  test("clears a host the platform no longer serves, or without a route", async () => {
    const result = await plan(
      [domain("broken.ru", at), domain("gone.ru", at), domain("ok.ru", at)],
      { routed: ["broken.ru", "ok.ru"], serving: ["ok.ru"] },
    );
    expect(result.secure).toEqual([]);
    expect(hosts(result.unsecure)).toEqual(["broken.ru", "gone.ru"]);
  });

  test("nothing works without a target to point DNS at", async () => {
    const result = await plan([domain("anna.ru", at)], { via: undefined });
    expect(hosts(result.unsecure)).toEqual(["anna.ru"]);
    expect(result.probed).toEqual([]);
  });

  test("a host still waiting for its certificate is simply left as is", async () => {
    const result = await plan([domain("anna.ru")], { serving: [] });
    expect(result).toMatchObject({ secure: [], unsecure: [] });
  });
});
