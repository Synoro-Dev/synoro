import { APP_CONFIG, paths } from "@synoro/config";

import { brand } from "./brand";

/** Absolute link into the product app (sign-up, login, demo booking page). */
const appLink = (path: string) => new URL(path, APP_CONFIG.url).toString();

export const site = {
  name: brand.name,
  url: APP_CONFIG.url,
  description:
    "Страница записи, расписание, пакеты консультаций и свой домен — всё, " +
    "чтобы клиенты записывались к вам сами, без переписки в мессенджерах.",
  links: {
    signup: appLink(paths.auth.signup),
    login: appLink(paths.auth.login),
    demo: appLink(paths.booking.public("klyuev")),
  },
} as const;

export type SiteLinks = typeof site.links;
