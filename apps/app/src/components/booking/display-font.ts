import { cn } from "@synoro/ui";
import { Literata, Manrope, Playfair_Display } from "next/font/google";

/**
 * The public booking pages' display faces: the specialist's name and the
 * chosen time. Everything else stays in the app's sans. Literata is the
 * default; the others are the owner's choice (`BookingTheme.font`), so they
 * are fetched only when a page uses them.
 */
const literata = Literata({
  subsets: ["latin", "cyrillic"],
  variable: "--font-literata",
});
const playfair = Playfair_Display({
  subsets: ["latin", "cyrillic"],
  variable: "--font-playfair",
  preload: false,
});
const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  preload: false,
});

/** Defines every display face's variable; set on the page's root. */
export const displayFonts = cn(
  literata.variable,
  playfair.variable,
  manrope.variable,
);
