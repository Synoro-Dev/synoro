import { APP_CONFIG } from "@synoro/config";
import { cn, ThemeProvider, ThemeToggle, Toaster } from "@synoro/ui";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { YandexMetrika } from "~/components/yandex-metrika";
import { env } from "~/env";
import { ORPCReactProvider } from "~/orpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production" ? APP_CONFIG.url : "http://localhost:3000",
  ),
  title: "Synoro",
  description:
    "Простой монорепозиторий с общим бэкендом для веб- и мобильных приложений",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Synoro",
    description:
      "Простой монорепозиторий с общим бэкендом для веб- и мобильных приложений",
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

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          geistSans.variable,
          geistMono.variable,
        )}
      >
        <ThemeProvider>
          <ORPCReactProvider>{props.children}</ORPCReactProvider>
          <div className="absolute right-4 bottom-4">
            <ThemeToggle />
          </div>
          <Toaster />
        </ThemeProvider>
        <YandexMetrika />
      </body>
    </html>
  );
}
