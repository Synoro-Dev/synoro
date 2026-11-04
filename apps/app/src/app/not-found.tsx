import { paths } from "@synoro/config";
import { BackButton, buttonVariants, ErrorScreen } from "@synoro/ui";
import { House } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Страница не найдена",
};

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Такой страницы нет"
      description="Ссылка устарела, или в адресе опечатка. Вернитесь назад или откройте главную."
    >
      <Link href={paths.dashboard.root} className={buttonVariants()}>
        <House data-icon="inline-start" aria-hidden />
        На главную
      </Link>
      <BackButton />
    </ErrorScreen>
  );
}
