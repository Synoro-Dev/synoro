import { buttonVariants, ErrorScreen } from "@synoro/ui";
import { LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Такой страницы нет"
      description="Проверьте адрес или вернитесь на обзор."
    >
      <Link href="/" className={buttonVariants()}>
        <LayoutDashboard data-icon="inline-start" aria-hidden />
        На обзор
      </Link>
    </ErrorScreen>
  );
}
