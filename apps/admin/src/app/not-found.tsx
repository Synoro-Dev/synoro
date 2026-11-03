import { Button } from "@synoro/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-medium">Не найдено</h1>
      <Button render={<Link href="/" />}>На обзор</Button>
    </main>
  );
}
