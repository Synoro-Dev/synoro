import { formatPhone } from "@synoro/validators";

/**
 * CSV the Russian Excel opens as it is: UTF-8 with a BOM, `;` between columns,
 * CRLF between rows, dates as ДД.ММ.ГГГГ ЧЧ:ММ in the practice's time zone.
 */

/** A value we produced ourselves: it can't carry a formula, so stays as is. */
interface Trusted {
  trusted: string;
}

export type Cell = string | number | null | undefined | Trusted;

/** What makes Excel read a cell as a formula, spreadsheets' CSV injection. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Written as a code: an editor saving the file would strip the character. */
const BOM = String.fromCharCode(0xfeff);

const E164 = /^\+\d{8,15}$/;

/**
 * A phone reads as text in Excel only with the spaces: a bare `+79001234567`
 * becomes a number. An E.164 number is digits only, so it needs no escaping.
 */
export function phoneCell(phone: string | null | undefined): Cell {
  if (!phone) return null;
  if (!E164.test(phone)) return phone;
  const formatted = formatPhone(phone);
  // Only Russian numbers get spaces from `formatPhone`; any space keeps it text.
  return {
    trusted:
      formatted === phone
        ? `${phone.slice(0, 3)} ${phone.slice(3)}`
        : formatted,
  };
}

function text(cell: Cell) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "object") return cell.trusted;
  // Someone typed it, a client perhaps: a leading apostrophe keeps it text.
  return FORMULA_START.test(cell.trimStart()) ? `'${cell}` : cell;
}

function quoted(value: string) {
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(headers: string[], rows: Cell[][]) {
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => quoted(text(cell))).join(";"),
  );
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** 05.11.2026 15:00, in `timeZone`. */
export function csvDate(
  at: Date | string | null | undefined,
  timeZone: string,
) {
  if (!at) return null;
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    trusted: `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`,
  };
}

/** Kopecks as rubles with a decimal comma, so Excel adds them up: 1490,00. */
export function rublesCell(kopecks: number) {
  return { trusted: (kopecks / 100).toFixed(2).replace(".", ",") };
}
