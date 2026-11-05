import { legal } from "@synoro/config";

import { paidPlan } from "./pricing";
import { site } from "./site";

const context = "https://schema.org";

export const organization = {
  "@context": context,
  "@type": "Organization",
  name: site.name,
  legalName: legal.operator.name,
  url: site.url,
  logo: new URL("/apple-touch-icon.png", site.url).href,
  email: legal.operator.email,
};

const offer = (name: string, price: number) => ({
  "@type": "Offer",
  name,
  price,
  priceCurrency: "RUB",
});

/** No `aggregateRating`: it needs real reviews on the page. */
export const softwareApplication = {
  "@context": context,
  "@type": "SoftwareApplication",
  name: site.name,
  url: site.url,
  description: site.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  inLanguage: "ru",
  offers: [
    offer("Бесплатный", 0),
    offer(`${paidPlan.name}, месяц`, paidPlan.monthly),
    offer(`${paidPlan.name}, год`, paidPlan.yearly),
  ],
};

/** `items` are the questions the page shows: nothing else may be marked up. */
export const faqPage = (items: readonly { q: string; a: string }[]) => ({
  "@context": context,
  "@type": "FAQPage",
  mainEntity: items.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});

/** JSON for a `<script>`: `<` can't close the tag early. */
export const serializeJsonLd = (data: object) =>
  JSON.stringify(data).replace(/</g, "\\u003c");
