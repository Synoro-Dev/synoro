import { z } from "zod";

/**
 * How a practice's public booking page looks, on «Про»: an accent color, the
 * headings' typeface, the corners, the backdrop and a few words about the
 * specialist under their name. Each setting is a preset, not a free value:
 * every preset is checked for contrast in light and dark themes (the CSS
 * lives in `apps/app/src/app/booking-theme.css`).
 */
export const BOOKING_ACCENTS = [
  "graphite",
  "emerald",
  "teal",
  "blue",
  "violet",
  "rose",
  "terracotta",
  "ochre",
] as const;

export type BookingAccent = (typeof BOOKING_ACCENTS)[number];

export const BOOKING_ACCENT_LABELS: Record<BookingAccent, string> = {
  graphite: "Графит",
  emerald: "Изумруд",
  teal: "Бирюза",
  blue: "Синий",
  violet: "Фиалка",
  rose: "Роза",
  terracotta: "Терракота",
  ochre: "Охра",
};

/** Typefaces of the specialist's name and the headings; text stays sans. */
export const BOOKING_FONTS = [
  "literata",
  "playfair",
  "manrope",
  "geist",
] as const;

export type BookingFont = (typeof BOOKING_FONTS)[number];

export const BOOKING_FONT_LABELS: Record<BookingFont, string> = {
  literata: "Книжный",
  playfair: "Изящный",
  manrope: "Современный",
  geist: "Строгий",
};

export const BOOKING_RADII = ["sharp", "default", "round"] as const;

export type BookingRadius = (typeof BOOKING_RADII)[number];

export const BOOKING_RADIUS_LABELS: Record<BookingRadius, string> = {
  sharp: "Строгие",
  default: "Обычные",
  round: "Мягкие",
};

/** plain — the theme's background; tint — washed with the accent. */
export const BOOKING_BACKDROPS = ["plain", "tint"] as const;

export type BookingBackdrop = (typeof BOOKING_BACKDROPS)[number];

export const BOOKING_BACKDROP_LABELS: Record<BookingBackdrop, string> = {
  plain: "Чистый",
  tint: "С оттенком",
};

/** The longest «about» line under the specialist's name. */
export const MAX_BOOKING_ABOUT = 300;

/** What the owner saves; every field has the default look. */
export const bookingThemeSchema = z.object({
  accent: z.enum(BOOKING_ACCENTS).default("graphite"),
  font: z.enum(BOOKING_FONTS).default("literata"),
  radius: z.enum(BOOKING_RADII).default("default"),
  backdrop: z.enum(BOOKING_BACKDROPS).default("plain"),
  about: z
    .string()
    .trim()
    .max(
      MAX_BOOKING_ABOUT,
      `Не длиннее ${MAX_BOOKING_ABOUT} символов — это пара предложений`,
    )
    .default(""),
});

export type BookingTheme = z.infer<typeof bookingThemeSchema>;

export const DEFAULT_BOOKING_THEME: BookingTheme = bookingThemeSchema.parse({});

/**
 * A stored theme as shown: a preset dropped since it was saved (or anything
 * unexpected) falls back to its default instead of breaking the page.
 */
export function readBookingTheme(value: unknown): BookingTheme {
  const stored =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const field = <T>(schema: z.ZodType<T>, raw: unknown, fallback: T) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : fallback;
  };
  const shape = bookingThemeSchema.shape;
  return {
    accent: field(shape.accent, stored.accent, DEFAULT_BOOKING_THEME.accent),
    font: field(shape.font, stored.font, DEFAULT_BOOKING_THEME.font),
    radius: field(shape.radius, stored.radius, DEFAULT_BOOKING_THEME.radius),
    backdrop: field(
      shape.backdrop,
      stored.backdrop,
      DEFAULT_BOOKING_THEME.backdrop,
    ),
    about: field(shape.about, stored.about, DEFAULT_BOOKING_THEME.about),
  };
}

/** Nothing changed from the default look: free plans may save it. */
export function isDefaultBookingTheme(theme: BookingTheme) {
  return (Object.keys(DEFAULT_BOOKING_THEME) as (keyof BookingTheme)[]).every(
    (key) => theme[key] === DEFAULT_BOOKING_THEME[key],
  );
}
