import { cn } from "@synoro/ui";
import type { Metadata, Viewport } from "next";
import { Geist_Mono, Onest } from "next/font/google";

import { AdClick } from "~/components/ad-click";
import { CookieNotice } from "~/components/cookie-notice";
import { Metrika } from "~/components/metrika";
import { env } from "~/env";
import { homeTitle, openGraph } from "~/lib/seo";
import { site } from "~/lib/site";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: homeTitle,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: openGraph({
    title: homeTitle,
    description: site.description,
    card: "home",
  }),
};

export const viewport: Viewport = {
  themeColor: "#fcfcfc",
};

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
});
const geistMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-mono",
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          onest.variable,
          geistMono.variable,
        )}
      >
        {props.children}
        {env.NEXT_PUBLIC_YANDEX_METRIKA_ID && (
          <>
            <AdClick />
            <Metrika id={env.NEXT_PUBLIC_YANDEX_METRIKA_ID} />
            <CookieNotice counterId={env.NEXT_PUBLIC_YANDEX_METRIKA_ID} />
          </>
        )}
      </body>
    </html>
  );
}
