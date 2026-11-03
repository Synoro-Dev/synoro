"use client";

import { Button } from "@synoro/ui";
import { useRouter } from "next/navigation";

import { authClient } from "~/auth/client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <Button
      variant="outline"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
      }}
    >
      Войти другим аккаунтом
    </Button>
  );
}
