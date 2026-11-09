import { readFileSync } from "node:fs";
import { request } from "node:https";
import { env, logger } from "@synoro/config";
import { and, db, eq, isNull, lt, or, PracticeDomain } from "@synoro/db";

import {
  hostOfRoute,
  ingressRoute,
  MANAGED_BY,
  MANAGED_LABEL,
  planReadiness,
  planRoutes,
  type RouteTarget,
  reachesUs,
  routeName,
  servesHttps,
} from "../custom-domains";

/**
 * Makes the cluster's Traefik routes match the connected domains
 * (docs/custom-domains.md, «Hosting»): one IngressRoute per verified domain,
 * which is what makes Traefik request its certificate. Each run also re-checks
 * which domains work (`planReadiness`: route, DNS, and the practice over https
 * through our own entry point) and sets or clears `secured_at`: the owner's
 * page says it's fully ready even if they closed it meanwhile, and a domain
 * that stops working stops being offered. A CronJob runs it every 5 minutes
 * (`schedule` in `infra/synoro/domains.yaml`, the infra submodule):
 *
 *   bun run packages/jobs/src/scripts/sync-domains.ts
 *
 * With `--dry-run` it only prints the plan and needs no cluster (locally:
 * `bun domains:sync -- --dry-run`). Talks to the Kubernetes API with the pod's
 * ServiceAccount; the Role there lets it touch IngressRoutes and nothing else,
 * and the code only ever lists or deletes the ones it labelled itself.
 */

const dryRun = process.argv.includes("--dry-run");

const SERVICE_ACCOUNT = "/var/run/secrets/kubernetes.io/serviceaccount";
const API = "kubernetes.default.svc";
const FIELD_MANAGER = MANAGED_BY;

/** Where a domain's traffic goes: the app, which serves it by `Host`. */
const TARGET: RouteTarget = {
  service: "synoro-app",
  port: "http",
  certResolver: "letsencrypt",
};

const read = (file: string) => readFileSync(`${SERVICE_ACCOUNT}/${file}`);

function kube(
  method: "GET" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: API,
        path,
        method,
        ca: read("ca.crt"),
        headers: {
          Authorization: `Bearer ${read("token").toString().trim()}`,
          Accept: "application/json",
          ...(body === undefined
            ? {}
            : // Server-side apply: create or update, no read-modify-write.
              { "Content-Type": "application/apply-patch+yaml" }),
        },
        timeout: 15_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error(`${method} ${path}: timeout`)),
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function expectOk(
  call: Promise<{ status: number; body: string }>,
  what: string,
  accepted: readonly number[] = [200, 201],
) {
  const response = await call;
  if (!accepted.includes(response.status)) {
    throw new Error(`${what}: ${response.status} ${response.body}`);
  }
  return response.body;
}

const hostnamesOf = (urls: (string | undefined)[]) =>
  urls.flatMap((url) => {
    try {
      return url ? [new URL(url).hostname] : [];
    } catch {
      return [];
    }
  });

async function main() {
  const namespace = dryRun ? "default" : read("namespace").toString().trim();
  const routes = `/apis/traefik.io/v1alpha1/namespaces/${namespace}/ingressroutes`;

  // Readiness writes only win over checks that started before this run.
  const startedAt = new Date();
  const rows = await db
    .select({
      id: PracticeDomain.id,
      hostname: PracticeDomain.hostname,
      verificationToken: PracticeDomain.verificationToken,
      practiceId: PracticeDomain.practiceId,
      securedAt: PracticeDomain.securedAt,
    })
    .from(PracticeDomain)
    .where(eq(PracticeDomain.status, "active"));
  const active = rows.map((row) => row.hostname);

  // Every route of the namespace, not only ours: a route that already has a
  // `cd-<host>` name but was made by someone else is theirs, not to be adopted.
  const listed = dryRun
    ? []
    : (
        JSON.parse(await expectOk(kube("GET", routes), "list routes")) as {
          items: {
            metadata: { name: string; labels?: Record<string, string> };
          }[];
        }
      ).items;
  const isOurs = (item: (typeof listed)[number]) =>
    item.metadata.labels?.[MANAGED_LABEL] === MANAGED_BY;
  const existing = listed
    .filter(isOurs)
    .flatMap((item) => hostOfRoute(item.metadata.name) ?? []);
  const foreign = new Set(
    listed.filter((item) => !isOurs(item)).map((item) => item.metadata.name),
  );

  const targets = {
    cname: env.CUSTOM_DOMAIN_CNAME?.trim().toLowerCase() || undefined,
  };
  const exactTrusted = (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .filter((origin) => origin && !/[*?]/.test(origin));
  const ownHosts = hostnamesOf([
    env.APP_URL,
    env.BOOKING_URL,
    env.ADMIN_URL,
    ...exactTrusted,
  ]);

  // One DNS lookup per host and run, shared by routes and readiness.
  const looked = new Map<string, Promise<boolean>>();
  const reaches = (host: string) => {
    let answer = looked.get(host);
    if (!answer) {
      answer = reachesUs(host, targets);
      looked.set(host, answer);
    }
    return answer;
  };

  const plan = await planRoutes({
    active,
    existing,
    ownHosts,
    reaches,
  });

  if (plan.refused.length > 0) {
    logger.warn("domains.sync_refused", { hosts: plan.refused });
  }
  logger.info("domains.sync_plan", {
    active: active.length,
    apply: plan.apply.length,
    remove: plan.remove,
    waiting: plan.waiting,
    dryRun,
  });
  if (dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  let failed = 0;
  for (const host of plan.apply) {
    if (foreign.has(routeName(host))) {
      failed++;
      logger.error("domains.sync_foreign_route", undefined, {
        host,
        route: routeName(host),
      });
      continue;
    }
    try {
      // No `force`: should a route appear between the list and this call, the
      // server answers 409 for fields another manager owns instead of
      // overwriting them.
      await expectOk(
        kube(
          "PATCH",
          `${routes}/${routeName(host)}?fieldManager=${FIELD_MANAGER}`,
          ingressRoute(host, TARGET),
        ),
        `apply ${host}`,
      );
    } catch (error) {
      failed++;
      logger.error("domains.sync_apply_failed", error, { host });
    }
  }
  for (const host of plan.remove) {
    try {
      await expectOk(
        kube("DELETE", `${routes}/${routeName(host)}`),
        `delete ${host}`,
        [200, 202, 404],
      );
    } catch (error) {
      failed++;
      logger.error("domains.sync_delete_failed", error, { host });
    }
  }
  const readiness = await planReadiness({
    domains: rows,
    routed: new Set(plan.apply),
    via: targets.cname,
    reaches,
    probe: servesHttps,
  });
  await setSecured(readiness.secure, startedAt, true);
  await setSecured(readiness.unsecure, startedAt, false);
  // A non-zero exit shows the failed Job in `kubectl get jobs`.
  if (failed > 0) process.exitCode = 1;
}

type CheckedDomain = {
  id: string;
  hostname: string;
  verificationToken: string;
};

/**
 * Marks (`secure`) or unmarks the domains `planReadiness` just checked — the
 * very records: a replacement hostname or a new reservation gets a new token,
 * and a domain that moved meanwhile isn't touched. A check (`domain.verify` or
 * another run) that started after this run and already wrote wins: its answer
 * is newer. A host whose certificate isn't there yet is simply checked again
 * on the next run.
 */
async function setSecured(
  domains: CheckedDomain[],
  startedAt: Date,
  secure: boolean,
) {
  if (domains.length === 0) return;
  await db
    .update(PracticeDomain)
    .set({ securedAt: secure ? startedAt : null, lastCheckedAt: startedAt })
    .where(
      and(
        or(
          ...domains.map((domain) =>
            and(
              eq(PracticeDomain.id, domain.id),
              eq(PracticeDomain.verificationToken, domain.verificationToken),
            ),
          ),
        ),
        eq(PracticeDomain.status, "active"),
        or(
          isNull(PracticeDomain.lastCheckedAt),
          // Strictly before: of two checks started in the same millisecond, the
          // first to write wins and the other can't undo it.
          lt(PracticeDomain.lastCheckedAt, startedAt),
        ),
      ),
    );
  const hosts = domains.map((domain) => domain.hostname);
  if (secure) logger.info("domains.sync_secured", { hosts });
  else logger.warn("domains.sync_unsecured", { hosts });
}

try {
  await main();
} catch (error) {
  logger.error("domains.sync_failed", error);
  process.exitCode = 1;
}
// The database pool would otherwise keep the process alive.
process.exit(process.exitCode ?? 0);
