import type { Session } from "@synoro/auth";
import { type Database, user } from "@synoro/db";
import { createTestDb } from "@synoro/db/testing";
import type { TemplateEmail } from "@synoro/emails";

import { createORPCContext } from "../src/orpc";

export const ADMIN_EMAIL = "admin@test.local";

/** Inserts a user row and returns a matching Better Auth session. */
export async function createSession(
  db: Database,
  overrides: {
    email?: string;
    name?: string;
    role?: string;
    phone?: string | null;
    emailVerified?: boolean;
  } = {},
): Promise<Session> {
  const now = new Date();
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `${crypto.randomUUID()}@test.local`,
      role: overrides.role ?? "user",
      emailVerified: overrides.emailVerified ?? false,
      phone: overrides.phone === undefined ? "+79001234567" : overrides.phone,
    })
    .returning();
  if (!row) throw new Error("Failed to insert test user");

  return {
    user: row,
    session: {
      id: crypto.randomUUID(),
      userId: row.id,
      token: crypto.randomUUID(),
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Fresh PGlite database plus a context factory bound to it. */
export async function setupTestApi() {
  const { db, close } = await createTestDb();

  /** Every email the procedures asked to send, in order. */
  const sent: TemplateEmail[] = [];
  const sendEmail = async (message: TemplateEmail) => {
    sent.push(message);
  };

  const context = (
    session: Session | null = null,
    headers: Record<string, string> = {},
  ) => ({
    ...createORPCContext({
      headers: new Headers(headers),
      session,
      sendEmail,
    }),
    db,
  });

  return { db, close, context, sent };
}
