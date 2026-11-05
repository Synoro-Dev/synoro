import type { Metadata } from "next";

import { site } from "./site";

export const homeTitle = `${site.name} — бесплатный сервис онлайн-записи клиентов`;

/** Link preview of a page, with its card from `/assets/og/<card>.png`. */
export function openGraph({
  title,
  description,
  url,
  card,
}: {
  title: string;
  description: string;
  /** Left out where the page has none of its own (the root layout). */
  url?: string;
  card: string;
}): Metadata["openGraph"] {
  return {
    title,
    description,
    url,
    siteName: site.name,
    locale: "ru_RU",
    type: "website",
    images: [
      {
        url: `/assets/og/${card}.png`,
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
  };
}
