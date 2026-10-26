"use client";

import { paths } from "@acme/config";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@acme/ui";
import { IconCopy } from "@tabler/icons-react";
import Link from "next/link";

import { AvailabilityEditor } from "./availability-editor";
import { MembersPanel } from "./members-panel";
import { ROLE_LABELS } from "./practice-list";
import { StaffCalendar } from "./staff-calendar";

/** Staff console of a practice: calendar, working hours, clients. */
export function PracticeWorkspace({
  practice,
}: {
  practice: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    membership: { role: "owner" | "admin" | "client" };
  };
}) {
  const publicPath = paths.booking.public(practice.slug);

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{practice.name}</h1>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABELS[practice.membership.role]} · часовой пояс расписания{" "}
            {practice.timezone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={publicPath} />}
          >
            Страница записи
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const url = new URL(publicPath, window.location.origin).href;
              try {
                await navigator.clipboard.writeText(url);
                toast.success("Ссылка для клиентов скопирована");
              } catch {
                toast.info(url);
              }
            }}
          >
            <IconCopy /> Ссылка
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">Календарь</TabsTrigger>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="clients">Клиенты</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar" className="pt-4">
          <StaffCalendar
            practiceId={practice.id}
            timezone={practice.timezone}
          />
        </TabsContent>
        <TabsContent value="schedule" className="pt-4">
          <AvailabilityEditor
            practiceId={practice.id}
            timezone={practice.timezone}
          />
        </TabsContent>
        <TabsContent value="clients" className="pt-4">
          <MembersPanel
            practiceId={practice.id}
            isOwner={practice.membership.role === "owner"}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
