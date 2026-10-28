"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import type { GoogleCalendarFormValues } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarSyncIcon } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";

type Connection = NonNullable<
  RouterOutputs["googleCalendar"]["settings"]["connection"]
>;

/** `?google=` set by the OAuth callback (`finishGoogleConnect`). */
const RESULTS: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: "Google Календарь подключён" },
  denied: { ok: false, message: "Доступ к Google Календарю не выдан" },
  scopes: {
    ok: false,
    message:
      "Разрешите доступ к календарю: отметьте все пункты на странице Google",
  },
  invalid: {
    ok: false,
    message: "Ссылка подключения устарела — попробуйте ещё раз",
  },
  error: {
    ok: false,
    message: "Google не ответил — попробуйте подключить ещё раз",
  },
};

/** Toast the result of the OAuth round trip once, then drop the parameter. */
function useConnectResult() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const result = searchParams.get("google");

  useEffect(() => {
    if (!result) return;
    const known = RESULTS[result];
    if (known) {
      (known.ok ? toast.success : toast.error)(known.message);
    }
    router.replace(pathname as Route, {
      scroll: false,
    });
  }, [result, router, pathname]);
}

function ConnectButton({
  practiceId,
  children,
  variant = "default",
}: {
  practiceId: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
}) {
  const connect = useMutation({
    ...orpc.googleCalendar.connect.mutationOptions(),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(error.message),
  });
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={connect.isPending || connect.isSuccess}
      onClick={() => connect.mutate({ practiceId })}
    >
      {children}
    </Button>
  );
}

function CalendarChoice({
  practiceId,
  connection,
}: {
  practiceId: string;
  connection: Connection;
}) {
  const queryClient = useQueryClient();
  const calendars = useQuery(
    orpc.googleCalendar.calendars.queryOptions({ input: { practiceId } }),
  );
  const [values, setValues] = useState<GoogleCalendarFormValues>({
    busyCalendarIds: connection.busyCalendarIds,
    eventsCalendarId: connection.eventsCalendarId,
    exportBookings: connection.exportBookings,
  });
  const update = useMutation({
    ...orpc.googleCalendar.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Настройки календаря сохранены");
      void queryClient.invalidateQueries({
        queryKey: orpc.googleCalendar.key(),
      });
      void queryClient.invalidateQueries({ queryKey: orpc.booking.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  if (calendars.isPending) return <Skeleton className="h-32 w-full" />;
  if (calendars.isError) {
    return (
      <Alert variant="warning">
        <AlertDescription>{calendars.error.message}</AlertDescription>
      </Alert>
    );
  }

  const list = calendars.data;
  const writable = list.filter((c) => c.canWrite);
  const toggleBusy = (id: string, checked: boolean) =>
    setValues((v) => ({
      ...v,
      busyCalendarIds: checked
        ? [...v.busyCalendarIds, id]
        : v.busyCalendarIds.filter((x) => x !== id),
    }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ practiceId, ...values });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Занятое время в этих календарях закрыто для записи
        </legend>
        {list.map((calendar) => (
          <Field key={calendar.id} orientation="horizontal">
            <Checkbox
              id={`gcal-busy-${calendar.id}`}
              checked={values.busyCalendarIds.includes(calendar.id)}
              onCheckedChange={(checked) => toggleBusy(calendar.id, checked)}
            />
            <FieldLabel
              htmlFor={`gcal-busy-${calendar.id}`}
              className="font-normal"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-muted-foreground"
                style={
                  calendar.color ? { background: calendar.color } : undefined
                }
              />
              {calendar.summary}
              {calendar.primary && (
                <Badge variant="secondary" size="sm">
                  Основной
                </Badge>
              )}
            </FieldLabel>
          </Field>
        ))}
      </fieldset>

      <div className="flex flex-col gap-3 rounded-md border p-3">
        <Field orientation="horizontal">
          <Switch
            id="gcal-export"
            checked={values.exportBookings}
            onCheckedChange={(checked) =>
              setValues((v) => ({ ...v, exportBookings: checked }))
            }
          />
          <FieldLabel htmlFor="gcal-export" className="font-normal">
            Добавлять записи клиентов в Google Календарь
          </FieldLabel>
        </Field>
        {values.exportBookings && (
          <Field className="max-w-sm">
            <FieldLabel htmlFor="gcal-events">Календарь для записей</FieldLabel>
            <Select
              items={Object.fromEntries(writable.map((c) => [c.id, c.summary]))}
              value={values.eventsCalendarId}
              onValueChange={(value) =>
                value && setValues((v) => ({ ...v, eventsCalendarId: value }))
              }
            >
              <SelectTrigger id="gcal-events" className="w-full">
                <SelectValue placeholder="Выберите" />
              </SelectTrigger>
              <SelectContent>
                {writable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.summary}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Отменённые записи удаляются из календаря.
            </FieldDescription>
          </Field>
        )}
      </div>

      <div>
        <Button type="submit" size="sm" disabled={update.isPending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}

/**
 * Link the specialist's Google Calendar: their busy time closes booking
 * slots, and bookings appear in the calendar. On the schedule page; the
 * owner manages it, administrators see the status.
 */
export function GoogleCalendarSync({ practiceId }: { practiceId: string }) {
  useConnectResult();
  const queryClient = useQueryClient();
  const settings = useQuery(
    orpc.googleCalendar.settings.queryOptions({ input: { practiceId } }),
  );
  const disconnect = useMutation({
    ...orpc.googleCalendar.disconnect.mutationOptions(),
    onSuccess: () => {
      toast.success("Google Календарь отключён");
      void queryClient.invalidateQueries({
        queryKey: orpc.googleCalendar.key(),
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const data = settings.data;
  if (data && !data.available && !data.connection) return null;
  const connection = data?.connection;

  return (
    <Frame spacing="default" className="min-w-0">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle>Google Календарь</FrameTitle>
          <FrameDescription>
            Встречи из вашего календаря закрывают время для записи, а записи
            клиентов появляются в календаре
          </FrameDescription>
        </FrameHeader>

        {!data ? (
          <Skeleton className="h-10 w-full" />
        ) : !connection ? (
          data.canManage ? (
            <div>
              <ConnectButton practiceId={practiceId}>
                <CalendarSyncIcon />
                Подключить Google Календарь
              </ConnectButton>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Не подключён. Подключить календарь может владелец практики.
            </p>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <IconTile variant="soft" aria-hidden="true">
                <CalendarSyncIcon />
              </IconTile>
              <span className="min-w-0 truncate font-medium">
                {connection.email}
              </span>
              {connection.lastError ? (
                <Badge variant="warning-light">Ошибка синхронизации</Badge>
              ) : (
                <Badge variant="success-light">Подключён</Badge>
              )}
              {data.canManage && (
                <div className="ml-auto">
                  <ConfirmButton
                    title="Отключить Google Календарь?"
                    description="Занятость из Google перестанет закрывать время, новые записи не попадут в календарь. Уже добавленные события останутся."
                    confirmLabel="Отключить"
                    disabled={disconnect.isPending}
                    onConfirm={() => disconnect.mutate({ practiceId })}
                  >
                    Отключить
                  </ConfirmButton>
                </div>
              )}
            </div>

            {connection.lastError && (
              <Alert variant="warning">
                <AlertTitle>{connection.lastError}</AlertTitle>
                {data.canManage && (
                  <AlertDescription className="flex flex-col items-start gap-2">
                    Пока это не исправлено, занятость из Google не учитывается.
                    <ConnectButton practiceId={practiceId} variant="outline">
                      Подключить заново
                    </ConnectButton>
                  </AlertDescription>
                )}
              </Alert>
            )}

            {data.canManage && (
              <CalendarChoice
                key={`${connection.email}:${connection.busyCalendarIds.join()}:${connection.eventsCalendarId}:${connection.exportBookings}`}
                practiceId={practiceId}
                connection={connection}
              />
            )}
          </>
        )}
      </FramePanel>
    </Frame>
  );
}
