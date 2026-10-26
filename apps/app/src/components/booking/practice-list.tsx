"use client";

import { paths } from "@acme/config";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@acme/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { orpc } from "~/orpc/react";
import { PracticeInvitations } from "./practice-invitations";

export const ROLE_LABELS = {
  owner: "Специалист",
  admin: "Администратор",
  client: "Клиент",
} as const;

/** Practices the user runs (→ console) or is a client of (→ booking page). */
export function PracticeList() {
  return (
    <div className="flex flex-col gap-6">
      <PracticeInvitations />
      <Memberships />
    </div>
  );
}

function Memberships() {
  const { data, isPending } = useQuery(orpc.practice.mine.queryOptions());

  if (isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Вы пока не состоите ни в одной практике. Создайте свою или откройте
        ссылку на страницу записи, которую дал специалист.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.map((p) => {
        const staff = p.role !== "client";
        return (
          <Card key={p.practiceId}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {p.name}
                <Badge variant={staff ? "default" : "secondary"}>
                  {ROLE_LABELS[p.role]}
                </Badge>
              </CardTitle>
              <CardDescription>
                {staff
                  ? `Страница записи: /p/${p.slug}`
                  : `Оплаченных консультаций: ${p.credits}`}
              </CardDescription>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link
                      href={
                        staff
                          ? paths.booking.practice(p.practiceId)
                          : paths.booking.public(p.slug)
                      }
                    />
                  }
                >
                  {staff ? "Открыть" : "Записаться"}
                </Button>
              </div>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}
