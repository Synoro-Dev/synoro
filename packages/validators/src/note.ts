import { z } from "zod";

/** A working note is a page or two, not a case file. */
export const CLIENT_NOTE_MAX = 10_000;

/** The text of a specialist's note on a client (`note.*`). */
export const clientNoteBodySchema = z
  .string()
  .trim()
  .min(1, "Напишите заметку")
  .max(CLIENT_NOTE_MAX, `Не больше ${CLIENT_NOTE_MAX} символов`);
