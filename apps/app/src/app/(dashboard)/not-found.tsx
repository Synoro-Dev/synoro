import { paths } from "@synoro/config";
import { BackButton, buttonVariants, ErrorScreen } from "@synoro/ui";
import { House } from "lucide-react";
import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Здесь ничего нет"
      description="Страница удалена, ссылка устарела или у вас нет к ней доступа."
      variant="inline"
    >
      <Link href={paths.dashboard.root} className={buttonVariants()}>
        <House data-icon="inline-start" aria-hidden />
        На главную
      </Link>
      <BackButton />
    </ErrorScreen>
  );
}
