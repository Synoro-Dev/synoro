import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, unique } from "drizzle-orm/pg-core";

import { Booking } from "./booking";
import { Practice, PracticeMember } from "./practice";

/**
 * offer            — the contract the specialist offers clients (оферта).
 * informed_consent — informed consent to the work itself.
 * personal_data    — consent to processing personal data, special categories
 *                    included; by law a document of its own.
 * other            — anything else the client must read.
 * Keep in sync with `DOCUMENT_KINDS` in `@synoro/validators`.
 */
export const documentKind = pgEnum("practice_document_kind", [
  "offer",
  "informed_consent",
  "personal_data",
  "other",
]);

/**
 * A document of the practice a client accepts when booking. The text lives
 * in versions (`practice_document_versions`): every change of title or text
 * is a new one, and a consent names the version it was given to. A document
 * the owner removed is archived, never deleted — consents point at it.
 */
export const PracticeDocument = pgTable(
  "practice_documents",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    kind: documentKind().notNull(),
    /** A client can't book without accepting it. */
    required: t.boolean().notNull().default(true),
    /** Removed by the owner: asked of nobody, kept for the consents given. */
    archived: t.boolean().notNull().default(false),
    position: t.smallint().notNull().default(0),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [index("practice_documents_practice_idx").on(table.practiceId)],
);

/** One wording of a document; the one with the highest `number` is in force. */
export const PracticeDocumentVersion = pgTable(
  "practice_document_versions",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    documentId: t
      .uuid()
      .notNull()
      .references(() => PracticeDocument.id, { onDelete: "cascade" }),
    number: t.integer().notNull(),
    title: t.varchar({ length: 160 }).notNull(),
    body: t.text().notNull(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    unique("practice_document_versions_number_unique").on(
      table.documentId,
      table.number,
    ),
  ],
);

/**
 * The fact that a client accepted a version of a document: who, which
 * wording, when, from what address and browser, and with which booking. For a
 * client under 18 a parent or guardian consents: `representativeName` is who,
 * `minorName` — for whom. A consent given for oneself and one given for a
 * child are separate rows, and one given for a child holds for that child
 * only. Never updated.
 */
export const Consent = pgTable(
  "consents",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    memberId: t
      .uuid()
      .notNull()
      .references(() => PracticeMember.id, { onDelete: "cascade" }),
    versionId: t
      .uuid()
      .notNull()
      .references(() => PracticeDocumentVersion.id, { onDelete: "cascade" }),
    /** The booking it was given with. */
    bookingId: t.uuid().references(() => Booking.id, { onDelete: "set null" }),
    acceptedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    /**
     * Given while signed in as the member. A visitor booking without signing
     * in names an address nobody has confirmed, so such a consent proves what
     * was ticked at that booking and nothing more: it never stands in for the
     * member's own, and they are asked again when they sign in.
     */
    bySession: t.boolean().notNull().default(false),
    /** As the proxy saw it (`clientIp`); null in development. */
    ip: t.varchar({ length: 64 }),
    userAgent: t.varchar({ length: 300 }),
    /** The parent or guardian who consented for a minor. */
    representativeName: t.varchar({ length: 120 }),
    /** The minor the consent is for. */
    minorName: t.varchar({ length: 120 }),
  }),
  (table) => [
    index("consents_member_version_idx").on(table.memberId, table.versionId),
    index("consents_practice_idx").on(table.practiceId),
  ],
);

export type DocumentKind = (typeof documentKind.enumValues)[number];
