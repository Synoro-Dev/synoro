import { BackButton, buttonVariants, ErrorScreen } from "@synoro/ui";
import { LayoutDashboard } from "lucide-react";
import Link from "next/link";

export default function AdminNotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Здесь ничего нет"
      description="Возможно, запись удалена или в адресе опечатка."
      variant="inline"
    >
      <Link href="/" className={buttonVariants()}>
        <LayoutDashboard data-icon="inline-start" aria-hidden />
        На обзор
      </Link>
      <BackButton />
    </ErrorScreen>
  );
}
