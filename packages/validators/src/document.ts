import { z } from "zod";

/**
 * What a practice's document is. Keep in sync with `documentKind` in
 * `@synoro/db`.
 */
export const DOCUMENT_KINDS = [
  "offer",
  "informed_consent",
  "personal_data",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  offer: "Договор-оферта",
  informed_consent: "Информированное согласие",
  personal_data: "Согласие на обработку персональных данных",
  other: "Другой документ",
};

/** How many documents a practice may ask a client to accept. */
export const DOCUMENTS_MAX = 5;
export const DOCUMENT_TITLE_MAX = 160;
export const DOCUMENT_BODY_MAX = 30_000;

/**
 * The words beside a document's checkbox: consent to processing data is
 * given, the rest is accepted.
 */
export function consentPhrase(kind: DocumentKind) {
  return kind === "personal_data" || kind === "informed_consent"
    ? "Даю согласие:"
    : "Принимаю:";
}

const documentSchema = z.object({
  /** Missing for a new document. */
  id: z.uuid().optional(),
  kind: z.enum(DOCUMENT_KINDS),
  title: z
    .string()
    .trim()
    .min(1, "Назовите документ")
    .max(DOCUMENT_TITLE_MAX, `Не больше ${DOCUMENT_TITLE_MAX} символов`),
  body: z
    .string()
    .trim()
    .min(1, "Добавьте текст документа")
    .max(DOCUMENT_BODY_MAX, `Не больше ${DOCUMENT_BODY_MAX} символов`),
  required: z.boolean(),
});

/** The practice's documents as the owner saves them (`document.save`). */
export const documentsFormSchema = z.object({
  documents: z
    .array(documentSchema)
    .max(DOCUMENTS_MAX, `Не больше ${DOCUMENTS_MAX} документов`),
  /** Clients under 18 are accepted: a parent consents for them. */
  acceptsMinors: z.boolean(),
});

export type DocumentFormValues = z.infer<typeof documentSchema>;

const personName = (message: string) =>
  z.string().trim().min(2, message).max(120, "Не длиннее 120 символов");

/**
 * What a client sends with a booking: the versions they ticked, and — when
 * booking for a child — who consents and for whom.
 */
export const consentsInput = z
  .object({
    versionIds: z.array(z.uuid()).max(DOCUMENTS_MAX * 2),
    minor: z
      .object({
        representativeName: personName("Укажите ваши фамилию и имя"),
        minorName: personName("Укажите имя ребёнка"),
      })
      .optional(),
  })
  .optional();

export type ConsentsInput = z.infer<typeof consentsInput>;
