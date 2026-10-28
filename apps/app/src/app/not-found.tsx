import { paths } from "@synoro/config";
import { Button } from "@synoro/ui";
import { Compass, House } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackButton, ErrorScreen } from "~/components/errors";

export const metadata: Metadata = {
  title: "Страница не найдена",
};

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Такой страницы нет"
      description="Возможно, ссылка устарела или в адресе опечатка. Вернитесь назад или откройте главную."
      icon={Compass}
    >
      <BackButton />
      <Button render={<Link href={paths.dashboard.root} />}>
        <House aria-hidden />
        На главную
      </Button>
    </ErrorScreen>
  );
}
