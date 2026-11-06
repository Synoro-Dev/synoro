/**
 * What a column of a client table can be, and guessing it from the header. Pure,
 * so the import wizard shows the same labels the server maps by.
 */

export const IMPORT_FIELDS = [
  "name",
  "lastName",
  "firstName",
  "middleName",
  "phone",
  "email",
  "note",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Имя и фамилия",
  lastName: "Фамилия",
  firstName: "Имя",
  middleName: "Отчество",
  phone: "Телефон",
  email: "Почта",
  note: "Заметка",
};

/**
 * Headers as people and services write them, in the form `headerKey` gives.
 *
 * YCLIENTS, DIKIDI and the like are covered by the same words, not by presets
 * of their own: a preset needs a real export of each service to be written
 * from, and a wrong guess about one would look more certain than it is. A
 * column nobody recognises is left for the specialist to say.
 */
const HEADERS: Record<ImportField, string[]> = {
  name: [
    "фио",
    "ф и о",
    "фио клиента",
    "фамилия имя отчество",
    "фамилия и имя",
    "имя и фамилия",
    "имя фамилия",
    "фамилия имя",
    "клиент",
    "имя клиента",
    "клиенты",
    "контакт",
    "гость",
    "пациент",
    "ученик",
    "name",
    "full name",
    "fullname",
    "client",
    "client name",
    "customer",
    "customer name",
    "contact",
  ],
  lastName: ["фамилия", "last name", "lastname", "surname", "family name"],
  firstName: ["имя", "first name", "firstname", "given name"],
  middleName: ["отчество", "middle name", "middlename", "patronymic"],
  phone: [
    "телефон",
    "тел",
    "номер телефона",
    "телефон клиента",
    "контактный телефон",
    "телефон 1",
    "основной телефон",
    "whatsapp",
    "мобильный",
    "мобильный телефон",
    "сотовый",
    "моб",
    "номер",
    "phone",
    "phone number",
    "mobile",
    "mobile phone",
    "tel",
    "telephone",
  ],
  email: [
    "почта",
    "email",
    "e mail",
    "эл почта",
    "электронная почта",
    "email клиента",
    "e mail клиента",
    "почта клиента",
    "емейл",
    "имейл",
    "mail",
    "e mail address",
    "email address",
  ],
  note: [
    "заметка",
    "заметки",
    "комментарий",
    "комментарии",
    "примечание",
    "примечания",
    "комментарий к клиенту",
    "note",
    "notes",
    "comment",
    "comments",
  ],
};

/** «Э-mail:» and «  E-Mail » read the same: lowercase, ё as е, words only. */
export function headerKey(header: string) {
  return header
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const BY_HEADER = new Map(
  (Object.entries(HEADERS) as [ImportField, string[]][]).flatMap(
    ([field, headers]) => headers.map((header) => [header, field] as const),
  ),
);

/**
 * A field per column, or null where the header says nothing. Each field once:
 * the first column claims it. A lone «Имя» with no surname column usually holds
 * the whole name, and notes come along too, but go in only when asked for.
 */
export function suggestMapping(headers: string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  const mapping = headers.map((header) => {
    const field = BY_HEADER.get(headerKey(header));
    if (!field || taken.has(field)) return null;
    taken.add(field);
    return field;
  });
  if (taken.has("firstName") && !taken.has("lastName") && !taken.has("name")) {
    return mapping.map((field) => (field === "firstName" ? "name" : field));
  }
  return mapping;
}
