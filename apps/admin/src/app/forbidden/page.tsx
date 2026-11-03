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
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-medium">Нет доступа</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        Этот аккаунт не администратор Synoro или его почта не подтверждена.
        Войдите по коду из письма на почту администратора.
      </p>
      <SignOutButton />
    </main>
  );
}
