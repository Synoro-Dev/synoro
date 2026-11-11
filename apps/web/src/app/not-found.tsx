import { buttonVariants, ErrorScreen } from "@synoro/ui";
import { House, LogIn } from "lucide-react";
import type { Metadata } from "next";

import { site } from "~/lib/site";

export const metadata: Metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Такой страницы нет"
      description="Ссылка устарела, или в адресе опечатка. Всё о Synoro — на главной."
    >
      <a href="/" className={buttonVariants()}>
        <House data-icon="inline-start" aria-hidden />
        На главную
      </a>
      <a
        href={site.links.login}
        className={buttonVariants({ variant: "outline" })}
      >
        <LogIn data-icon="inline-start" aria-hidden />
        Войти
      </a>
    </ErrorScreen>
  );
}
