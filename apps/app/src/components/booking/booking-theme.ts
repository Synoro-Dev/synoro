import type { BookingTheme } from "@synoro/validators";

/**
 * The `data-booking-*` attributes booking-theme.css re-tints the tokens by.
 * Set them on the booking page's root, under `displayFonts`.
 */
export function bookingThemeAttributes(theme: BookingTheme) {
  return {
    "data-booking-accent": theme.accent,
    "data-booking-font": theme.font,
    "data-booking-radius": theme.radius,
    "data-booking-backdrop": theme.backdrop,
  };
}
