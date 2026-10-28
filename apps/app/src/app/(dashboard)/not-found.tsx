import { paths } from "@synoro/config";
import { Button } from "@synoro/ui";
import { Compass, House } from "lucide-react";
import Link from "next/link";

import { BackButton, ErrorScreen } from "~/components/errors";

export default function DashboardNotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Здесь ничего нет"
      description="Запись удалена, ссылка устарела или у вас нет к ней доступа."
      icon={Compass}
      variant="inline"
    >
      <BackButton />
      <Button render={<Link href={paths.dashboard.root} />}>
        <House aria-hidden />
        На главную
      </Button>
    </ErrorScreen>
  );
}
