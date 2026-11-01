import { Literata } from "next/font/google";

/**
 * The public booking pages' display face: the specialist's name and the
 * chosen time. Everything else stays in the app's sans.
 */
export const displayFont = Literata({
  subsets: ["latin", "cyrillic"],
  variable: "--font-literata",
});
