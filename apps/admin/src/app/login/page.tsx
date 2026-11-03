import type { Metadata } from "next";

import { LoginForm } from "~/components/login-form";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <main className="bg-muted flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </main>
  );
}
