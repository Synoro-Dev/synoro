import type { MetadataRoute } from "next";

import { professionPages, professionPath } from "~/lib/professions";
import { site } from "~/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url },
    ...professionPages.map((page) => ({
      url: new URL(professionPath(page), site.url).toString(),
    })),
  ];
}
