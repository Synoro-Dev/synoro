import { APP_CONFIG } from "@synoro/config";
import { cn, ThemeProvider, Toaster } from "@synoro/ui";
import type { Metadata, Viewport } from "next";
import { Geist_Mono, Onest } from "next/font/google";
import { YandexMetrika } from "~/components/yandex-metrika";
import { APP_DESCRIPTION } from "~/lib/page-metadata";
import { ORPCReactProvider } from "~/orpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_CONFIG.url),
  title: "Synoro",
  description: APP_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Synoro",
    description: APP_DESCRIPTION,
    url: APP_CONFIG.url,
    siteName: "Synoro",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
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
    <html lang="ru" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          onest.variable,
          geistMono.variable,
        )}
      >
        <ThemeProvider>
          <ORPCReactProvider>{props.children}</ORPCReactProvider>
          <Toaster />
        </ThemeProvider>
        <YandexMetrika />
      </body>
    </html>
  );
}
