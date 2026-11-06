import { and, asc, type Database, eq, Service } from "@synoro/db";

/** What a booking needs to know about the service it is made for. */
export interface BookableService {
  /** Null for the implicit service of a practice that has none yet. */
  id: string | null;
  name: string;
  minutes: number;
  credits: number;
}

/**
 * Practices that predate services (or tests that insert one by hand) have no
 * row: they book an hour for one credit, as it always was.
 */
const DEFAULT_SERVICE: BookableService = {
  id: null,
  name: "",
  minutes: 60,
  credits: 1,
};

const columns = {
  id: Service.id,
  name: Service.name,
  minutes: Service.minutes,
  credits: Service.credits,
} as const;

/** The practice's switched-on services in the order the page shows them. */
export function activeServices(db: Database, practiceId: string) {
  return db
    .select(columns)
    .from(Service)
    .where(and(eq(Service.practiceId, practiceId), eq(Service.active, true)))
    .orderBy(asc(Service.position), asc(Service.createdAt));
}

/**
 * The service a booking is made for: `serviceId` when given — it must be an
 * active service of this practice, else undefined — otherwise the first one
 * shown, or the implicit hour when the practice has none.
 */
export async function resolveService(
  db: Database,
  practiceId: string,
  serviceId?: string,
): Promise<BookableService | undefined> {
  if (serviceId) {
    const [service] = await db
      .select(columns)
      .from(Service)
      .where(
        and(
          eq(Service.id, serviceId),
          eq(Service.practiceId, practiceId),
          eq(Service.active, true),
        ),
      );
    return service;
  }
  const [first] = await activeServices(db, practiceId).limit(1);
  return first ?? DEFAULT_SERVICE;
}
