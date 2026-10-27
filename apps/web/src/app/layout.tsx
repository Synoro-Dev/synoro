import { cn } from "@synoro/ui";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Metrika } from "~/components/metrika";
import { env } from "~/env";
import { featuredPlan, perMonth, rubles } from "~/lib/pricing";
import { site } from "~/lib/site";

import "~/app/styles.css";

const title = `${site.name} — онлайн-запись для частной практики от ${rubles(perMonth(featuredPlan.yearly))}/мес`;
const description = `${site.description} Год за ${rubles(featuredPlan.yearly)}, есть бесплатный тариф.`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: title,
    template: `%s · ${site.name}`,
  },
  description,
  openGraph: {
    title,
    description,
    url: site.url,
    siteName: site.name,
    locale: "ru_RU",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#fcfcfc",
};

const geistSans = Geist({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-sans",
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
          geistSans.variable,
          geistMono.variable,
        )}
      >
        {props.children}
        {env.NEXT_PUBLIC_YANDEX_METRIKA_ID && (
          <Metrika id={env.NEXT_PUBLIC_YANDEX_METRIKA_ID} />
        )}
      </body>
    </html>
  );
}
