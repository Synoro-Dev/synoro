import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { brand } from "~/lib/brand";
import { homeHero, professionPage, professionPages } from "~/lib/professions";

/**
 * Link previews, `/assets/og/<card>.png`, rendered at build time. Not
 * `opengraph-image.tsx`: its address on the home page, `/opengraph-image`,
 * looks like a booking page and Traefik would send it to the app.
 */
export function generateStaticParams() {
  return ["home", ...professionPages.map(({ slug }) => slug)].map((card) => ({
    page: `${card}.png`,
  }));
}

const FONT_DIR = join(process.cwd(), "src/assets/fonts");

/** Satori takes static fonts only, one file per subset and weight. */
const font = async (subset: "cyrillic" | "latin", weight: 400 | 600) => ({
  name: "Onest",
  weight,
  style: "normal" as const,
  data: await readFile(join(FONT_DIR, `onest-${subset}-${weight}-normal.woff`)),
});

export async function GET(
  _request: Request,
  { params }: RouteContext<"/assets/og/[page]">,
) {
  const card = (await params).page.replace(/\.png$/, "");
  const png = await renderCard(card);
  if (!png) return new Response(null, { status: 404 });
  return new Response(png, { headers: { "Content-Type": "image/png" } });
}

/** Cached: without it, reading the fonts keeps the route from prerendering. */
async function renderCard(card: string) {
  "use cache";
  const hero = card === "home" ? homeHero : professionPage(card);
  if (!hero) return null;

  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 72,
        fontFamily: "Onest",
        fontWeight: 600,
        color: "#18181b",
        backgroundColor: "#fcfcfc",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg aria-hidden width="56" height="56" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="7" fill="#18181b" />
          <rect x="5.5" y="5.5" width="5.5" height="5.5" rx="1.5" fill="#fff" />
          <rect
            x="13"
            y="5.5"
            width="5.5"
            height="5.5"
            rx="1.5"
            fill="#fff"
            fillOpacity=".35"
          />
          <rect
            x="5.5"
            y="13"
            width="5.5"
            height="5.5"
            rx="1.5"
            fill="#fff"
            fillOpacity=".35"
          />
          <rect
            x="13"
            y="13"
            width="5.5"
            height="5.5"
            rx="1.5"
            fill="#fff"
            fillOpacity=".35"
          />
        </svg>
        <span style={{ fontSize: 40, letterSpacing: "-0.02em" }}>
          {brand.name}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          fontSize: 76,
          lineHeight: 1.05,
          letterSpacing: "-0.035em",
        }}
      >
        {hero.h1}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 28,
          fontSize: 34,
          fontWeight: 400,
          color: "#71717a",
        }}
      >
        {hero.heading.join(" ")}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: await Promise.all([
        font("cyrillic", 600),
        font("latin", 600),
        font("cyrillic", 400),
        font("latin", 400),
      ]),
    },
  );
  return new Uint8Array(await image.arrayBuffer());
}
