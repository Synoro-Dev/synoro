import { APP_CONFIG, paths } from "@synoro/config";

import { env } from "~/env";

import { brand } from "./brand";

/** Absolute link into the product app (sign-up, login). */
const appLink = (path: string) => new URL(path, APP_CONFIG.url).toString();

export const site = {
  name: brand.name,
  url: env.NEXT_PUBLIC_SITE_URL,
  description:
    "Страница записи, расписание и пакеты с предоплатой для частной практики. " +
    "Клиенты записываются сами. Бесплатно и без лимита записей.",
  links: {
    signup: appLink(paths.auth.signup),
    login: appLink(paths.auth.login),
    /** Optional: demo CTAs render only when a live page is configured. */
    demo: env.NEXT_PUBLIC_DEMO_URL,
  },
} as const;

export type SiteLinks = typeof site.links;
