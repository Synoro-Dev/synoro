import { z } from "zod";

/**
 * A phone number as E.164 (`+79001234567`), or null when it isn't one.
 *
 * Russian numbers are accepted the way people type them: `8 900 123-45-67`,
 * `7 (900) 123 45 67`, `900 123-45-67`. Anything starting with `+` is taken as
 * international: 10–15 digits, and exactly 11 for `+7`.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    if (digits.length < 10 || digits.length > 15) return null;
    if (digits.startsWith("7") && digits.length !== 11) return null;
    return `+${digits}`;
  }
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits[0] === "9") return `+7${digits}`;
  return null;
}

/** `+79001234567` → `+7 900 123-45-67`; other numbers are left as they are. */
export function formatPhone(phone: string): string {
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+7 ${match[1]} ${match[2]}-${match[3]}-${match[4]}` : phone;
}

/** The form input is whatever was typed; the parsed value is E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Укажите номер телефона")
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({
        code: "custom",
        message: "Введите номер телефона, например +7 900 123-45-67",
      });
      return z.NEVER;
    }
    return phone;
  });
