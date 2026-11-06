import { strFromU8, unzip, unzipSync } from "fflate";

/**
 * Turning an uploaded file into a table of strings. What the file calls itself
 * is not trusted: the kind is read from its bytes, the encoding and separator
 * from its text. Bad input throws `FileProblem`, with words for the specialist.
 */

export class FileProblem extends Error {}

/** More than any private practice has; a brake on the worst inputs. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 200;
/** An XLSX is a ZIP: what it unpacks to is what must be small. */
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

export interface Table {
  headers: string[];
  rows: string[][];
  /** Line of the file each row came from, for telling people where to look. */
  lines: number[];
  encoding: "utf-8" | "windows-1251" | null;
  delimiter: string | null;
}

export type FileKind = "csv" | "xlsx" | "ics" | "json";

/** By the bytes. A ZIP that isn't a workbook, or binary data, is refused. */
export function detectKind(bytes: Uint8Array): FileKind {
  if (bytes.length === 0) throw new FileProblem("Файл пустой");
  if (bytes.length > MAX_FILE_BYTES) {
    throw new FileProblem("Файл больше 10 МБ. Разделите его на несколько");
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return hasZipEntry(bytes, "data.json") ? "json" : "xlsx";
  }
  const start = new Set(bytes.subarray(0, 8192));
  if (start.has(0)) {
    throw new FileProblem(
      "Это не похоже на таблицу. Сохраните её как CSV или XLSX",
    );
  }
  const text = decodeText(bytes).text.trimStart().slice(0, 64).toUpperCase();
  if (text.startsWith("BEGIN:VCALENDAR")) return "ics";
  if (text.startsWith("{")) return "json";
  return "csv";
}

/** Looks at the names in a ZIP without unpacking anything. */
function hasZipEntry(bytes: Uint8Array, name: string) {
  let found = false;
  try {
    unzipSync(bytes, {
      filter(file) {
        if (file.name === name) found = true;
        return false;
      },
    });
  } catch {
    throw new FileProblem("Не получилось прочитать файл. Он не повреждён?");
  }
  return found;
}

/** A BOM decides; then strict UTF-8; whatever fails that is Windows-1251. */
export function decodeText(bytes: Uint8Array): {
  text: string;
  encoding: "utf-8" | "windows-1251";
} {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return {
      text: new TextDecoder("windows-1251").decode(bytes),
      encoding: "windows-1251",
    };
  }
}

/** Splits by `delimiter`, keeping quoted separators and line breaks intact. */
function splitCsv(text: string, delimiter: string) {
  const rows: { cells: string[]; line: number }[] = [];
  let cell = "";
  let cells: string[] = [];
  let quoted = false;
  let line = 1;
  let startLine = 1;

  const endRow = () => {
    cells.push(cell);
    rows.push({ cells, line: startLine });
    cell = "";
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      startLine = line;
    } else {
      cell += char;
    }
  }
  if (cell !== "" || cells.length > 0) endRow();
  return rows;
}

const DELIMITERS = [";", ",", "\t", "|"];

/** The separator that gives the most columns, the same number on most lines. */
export function detectDelimiter(text: string) {
  const sample = text.slice(0, 64 * 1024);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const lines = splitCsv(sample, delimiter)
      .slice(0, 50)
      .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
    const widths = new Map<number, number>();
    for (const { cells } of lines) {
      widths.set(cells.length, (widths.get(cells.length) ?? 0) + 1);
    }
    for (const [width, times] of widths) {
      if (width < 2) continue;
      const score = times * width;
      if (score > bestScore) {
        bestScore = score;
        best = delimiter;
      }
    }
  }
  return best;
}

function toTable(
  raw: { cells: string[]; line: number }[],
  extra: Pick<Table, "encoding" | "delimiter">,
): Table {
  const filled = raw.filter(({ cells }) =>
    cells.some((cell) => cell.trim() !== ""),
  );
  const [head, ...body] = filled;
  if (!head) throw new FileProblem("В файле нет ни одной строки");
  if (head.cells.length > MAX_COLUMNS) {
    throw new FileProblem("Слишком много колонок. Это точно таблица клиентов?");
  }
  if (body.length > MAX_ROWS) {
    throw new FileProblem(
      `В файле больше ${MAX_ROWS} строк. Разделите его на несколько`,
    );
  }
  return {
    headers: head.cells.map((cell) => cell.trim()),
    rows: body.map(({ cells }) => cells.map((cell) => cell.trim())),
    lines: body.map(({ line }) => line),
    ...extra,
  };
}

function readCsv(bytes: Uint8Array): Table {
  const { text, encoding } = decodeText(bytes);
  const delimiter = detectDelimiter(text);
  return toTable(splitCsv(text, delimiter), { encoding, delimiter });
}

function xmlText(xml: string) {
  return xml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

/** «C5» → 2: letters to a column number. */
function columnOf(ref: string) {
  let column = 0;
  for (const letter of ref.replace(/\d+/g, "")) {
    column = column * 26 + letter.charCodeAt(0) - 64;
  }
  return column - 1;
}

/** Sums what the ZIP says it unpacks to, before unpacking anything. */
function checkUnpackedSize(bytes: Uint8Array) {
  let total = 0;
  unzip(
    bytes,
    {
      filter(file) {
        total += file.originalSize;
        if (total > MAX_UNPACKED_BYTES) {
          throw new FileProblem("Файл распаковывается в слишком большой объём");
        }
        return false;
      },
    },
    () => {},
  );
}

/**
 * The first sheet of a workbook. A few regular expressions, not an XML parser:
 * only cells are read, so nothing in the file can make us fetch or expand
 * anything. A phone in a number cell can come as 7.9001234567E10: back to digits.
 */
function readXlsx(bytes: Uint8Array): Table {
  checkUnpackedSize(bytes);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) =>
        file.name === "xl/sharedStrings.xml" ||
        file.name === "xl/workbook.xml" ||
        file.name === "xl/_rels/workbook.xml.rels" ||
        file.name.startsWith("xl/worksheets/"),
    });
  } catch {
    throw new FileProblem("Не получилось прочитать файл. Он не повреждён?");
  }
  const text = (name: string) => {
    const file = files[name];
    return file ? strFromU8(file) : "";
  };
  if (!files["xl/workbook.xml"]) {
    throw new FileProblem("Это архив, а не таблица. Загрузите CSV или XLSX");
  }

  const relId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(
    text("xl/workbook.xml"),
  )?.[1];
  const target = relId
    ? new RegExp(`<Relationship\\b[^>]*\\bId="${relId}"[^>]*>`).exec(
        text("xl/_rels/workbook.xml.rels"),
      )?.[0]
    : undefined;
  const path = /\bTarget="([^"]+)"/
    .exec(target ?? "")?.[1]
    ?.replace(/^\/?xl\//, "");
  const sheet = text(`xl/${path ?? "worksheets/sheet1.xml"}`);

  const shared = [
    ...text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map(([, item]) =>
    [...(item ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(([, part]) => xmlText(part ?? ""))
      .join(""),
  );

  const raw: { cells: string[]; line: number }[] = [];
  for (const [, attrs, content] of sheet.matchAll(
    /<row\b([^>]*)>([\s\S]*?)<\/row>/g,
  )) {
    const cells: string[] = [];
    for (const [, cellAttrs, cell] of (content ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cellAttrs ?? "")?.[1];
      const type = /\bt="(\w+)"/.exec(cellAttrs ?? "")?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell ?? "")?.[1] ?? "";
      const inline = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cell ?? "")?.[1];
      let read: string;
      if (type === "s") read = shared[Number(value)] ?? "";
      else if (inline !== undefined) read = xmlText(inline);
      else if (/^-?\d+(\.\d+)?E\+?\d+$/i.test(value)) {
        read = Number(value).toFixed(0);
      } else read = xmlText(value);

      const column = ref ? columnOf(ref) : cells.length;
      if (column >= MAX_COLUMNS) continue;
      while (cells.length < column) cells.push("");
      cells[column] = read;
    }
    const line = Number(/\br="(\d+)"/.exec(attrs ?? "")?.[1] ?? raw.length + 1);
    raw.push({ cells, line });
  }
  return toTable(raw, { encoding: null, delimiter: null });
}

export function readTable(bytes: Uint8Array): Table {
  const kind = detectKind(bytes);
  if (kind === "xlsx") return readXlsx(bytes);
  if (kind === "csv") return readCsv(bytes);
  throw new FileProblem("Здесь нужна таблица: CSV или XLSX");
}
