import { ErrorScreen } from "@synoro/ui";
import type { Metadata } from "next";

import { SignOutButton } from "~/components/sign-out-button";

export const metadata: Metadata = { title: "Нет доступа" };

/**
 * A signed-in account without admin rights or with an unverified address:
 * the session cookie is shared with app.synoro.ru, so a specialist can land
 * here already signed in.
 */
export default function ForbiddenPage() {
  return (
    <ErrorScreen
      code="403"
      title="Нет доступа"
      description="Этот аккаунт не администратор Synoro или его почта не подтверждена. Войдите по коду из письма на почту администратора."
    >
      <SignOutButton />
    </ErrorScreen>
  );
}
