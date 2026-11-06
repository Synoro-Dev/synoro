import { YOUR_DATA_PATH } from "@synoro/config";
import type { MetadataRoute } from "next";

import { professionPages, professionPath } from "~/lib/professions";
import { site } from "~/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url },
    { url: new URL(YOUR_DATA_PATH, site.url).toString() },
    ...professionPages.map((page) => ({
      url: new URL(professionPath(page), site.url).toString(),
    })),
  ];
}
