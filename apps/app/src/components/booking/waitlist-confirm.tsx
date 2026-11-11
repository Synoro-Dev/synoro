"use client";

import { paths } from "@synoro/config";
import { Button, Card, Spinner } from "@synoro/ui";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { useMutation } from "@tanstack/react-query";
import { BellRingIcon, CalendarPlusIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";

import { orpc } from "~/orpc/react";

/**
 * Where the link in the waiting-list mail lands. A button, not a confirmation
 * on load: mail programs open links to check them, and that must not speak for
 * the person. Once confirmed, the wish is real and the address is written to
 * when matching time frees up.
 */
export function WaitlistConfirm({ token }: { token: string }) {
  const confirm = useMutation(orpc.waitlist.confirm.mutationOptions());
  const practice = confirm.data?.practice;

  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-8 md:items-center md:py-12 dark:bg-background">
      <Card className="w-full max-w-lg gap-5 p-6">
        <IconTile variant="soft" size="lg" aria-hidden="true">
          {practice ? (
            <CircleCheckIcon className="text-success" />
          ) : (
            <BellRingIcon />
          )}
        </IconTile>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {practice ? "Вы в листе ожидания" : "Подтвердите лист ожидания"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {practice
              ? `Когда у «${practice.name}» освободится подходящее время, мы один раз напишем вам на эту почту. Время ни за кем не закрепляется: записывается тот, кто успел первым.`
              : "Подтвердите, что это ваша почта, — после этого мы напишем, когда освободится подходящее время."}
          </p>
        </div>

        {confirm.isError && (
          <p role="alert" className="text-sm text-destructive">
            {confirm.error.message}
          </p>
        )}

        {practice ? (
          <Button
            nativeButton={false}
            render={<Link href={paths.booking.public(practice.slug)} />}
          >
            <CalendarPlusIcon />
            Страница записи
          </Button>
        ) : (
          <Button
            disabled={confirm.isPending}
            onClick={() => confirm.mutate({ token })}
          >
            {confirm.isPending && <Spinner />}
            Подтвердить
          </Button>
        )}
      </Card>
    </main>
  );
}
