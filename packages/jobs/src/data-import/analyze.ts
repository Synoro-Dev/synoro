import {
  and,
  type Database,
  eq,
  PracticeClient,
  PracticeMember,
  user,
} from "@synoro/db";
import { type ImportField, normalizePhone } from "@synoro/validators";

import type { Table } from "./parse";

/** What a row of a table says about a client, cleaned up. */
export interface CleanClient {
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
}

export type RowResult = {
  /** Line of the file. */
  line: number;
  index: number;
} & (
  | { status: "new"; client: CleanClient }
  | {
      status: "duplicate";
      client: CleanClient;
      /** A card can be filled in; a client with a cabinet is theirs to edit. */
      match:
        | { kind: "card"; id: string }
        | { kind: "member" }
        | { kind: "file" };
      by: "phone" | "email";
    }
  | { status: "error"; reasons: string[] }
);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 120;
const NOTE_MAX = 2000;
const ESCAPED = /^'(?=[=+\-@])/;

/** Our own export escapes these with an apostrophe: back to what they were. */
function unescaped(value: string) {
  return value.replace(ESCAPED, "");
}

/** Several numbers in a cell: the first one is the client's. */
function firstPhone(value: string) {
  return value.split(/[,;/]|\s{2,}/)[0]?.trim() ?? "";
}

/** One row against the mapping. Null: nothing in it, not worth a word. */
export function cleanRow(
  row: string[],
  mapping: (string | null)[],
): { client: CleanClient } | { reasons: string[] } | null {
  const field = (name: ImportField) => {
    const index = mapping.indexOf(name);
    return index >= 0 ? unescaped(row[index] ?? "").trim() : "";
  };

  const composed = [field("lastName"), field("firstName"), field("middleName")]
    .filter(Boolean)
    .join(" ");
  const name = (field("name") || composed).replace(/\s+/g, " ");
  const rawPhone = field("phone");
  const rawEmail = field("email").toLowerCase();
  const note = field("note");
  if (!name && !rawPhone && !rawEmail && !note) return null;

  const reasons: string[] = [];
  if (!name) reasons.push("нет имени");
  if (name.length > NAME_MAX) {
    reasons.push(`имя длиннее ${NAME_MAX} символов`);
  }
  const phone = rawPhone ? normalizePhone(firstPhone(rawPhone)) : null;
  if (rawPhone && !phone) reasons.push(`не распознан телефон «${rawPhone}»`);
  if (rawEmail && !EMAIL.test(rawEmail)) {
    reasons.push(`не распознана почта «${rawEmail}»`);
  }
  if (note.length > NOTE_MAX)
    reasons.push(`заметка длиннее ${NOTE_MAX} символов`);
  if (reasons.length > 0) return { reasons };

  return {
    client: { name, phone, email: rawEmail || null, note: note || null },
  };
}

export interface Existing {
  phones: Map<string, { kind: "card"; id: string } | { kind: "member" }>;
  emails: Map<string, { kind: "card"; id: string } | { kind: "member" }>;
}

/** Who the practice already knows: cards, and clients with a cabinet. */
export async function loadExisting(
  db: Database,
  practiceId: string,
): Promise<Existing> {
  const [cards, members] = await Promise.all([
    db
      .select({
        id: PracticeClient.id,
        phone: PracticeClient.phone,
        email: PracticeClient.email,
      })
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, practiceId)),
    db
      .select({ phone: user.phone, email: user.email })
      .from(PracticeMember)
      .innerJoin(user, eq(user.id, PracticeMember.userId))
      .where(
        and(
          eq(PracticeMember.practiceId, practiceId),
          eq(PracticeMember.role, "client"),
        ),
      ),
  ]);

  const existing: Existing = { phones: new Map(), emails: new Map() };
  for (const member of members) {
    if (member.phone) existing.phones.set(member.phone, { kind: "member" });
    existing.emails.set(member.email.toLowerCase(), { kind: "member" });
  }
  for (const card of cards) {
    const match = { kind: "card" as const, id: card.id };
    if (card.phone) existing.phones.set(card.phone, match);
    if (card.email) existing.emails.set(card.email, match);
  }
  return existing;
}

/**
 * Every row of the table: new, a duplicate (by phone, then by email, of someone
 * the practice knows or of an earlier row) or an error with the reason. Blank
 * rows and columns nobody mapped don't count. Writes nothing.
 */
export function analyzeRows(
  table: Table,
  mapping: (string | null)[],
  existing: Existing,
): RowResult[] {
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const results: RowResult[] = [];

  table.rows.forEach((row, index) => {
    const line = table.lines[index] ?? index + 2;
    const cleaned = cleanRow(row, mapping);
    if (!cleaned) return;
    if ("reasons" in cleaned) {
      results.push({ status: "error", line, index, reasons: cleaned.reasons });
      return;
    }

    const { client } = cleaned;
    const known =
      (client.phone && existing.phones.get(client.phone)) ||
      (client.email && existing.emails.get(client.email));
    if (known) {
      results.push({
        status: "duplicate",
        line,
        index,
        client,
        match: known,
        by:
          client.phone && existing.phones.has(client.phone) ? "phone" : "email",
      });
    } else if (
      (client.phone && seenPhones.has(client.phone)) ||
      (client.email && seenEmails.has(client.email))
    ) {
      results.push({
        status: "duplicate",
        line,
        index,
        client,
        match: { kind: "file" },
        by: client.phone && seenPhones.has(client.phone) ? "phone" : "email",
      });
    } else {
      results.push({ status: "new", line, index, client });
    }
    if (client.phone) seenPhones.add(client.phone);
    if (client.email) seenEmails.add(client.email);
  });
  return results;
}
