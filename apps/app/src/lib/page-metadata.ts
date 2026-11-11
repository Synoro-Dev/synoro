import type { Metadata } from "next";

export const APP_DESCRIPTION =
  "Онлайн-запись к специалистам частной практики: свободное время, запись и кабинет клиента";

/** Title and link preview of a practice's booking page at `url`. */
export function practiceMetadata(name: string, url: string): Metadata {
  const title = `${name} · онлайн-запись`;
  return {
    title,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: APP_DESCRIPTION,
      url,
      siteName: "Synoro",
    },
  };
}
