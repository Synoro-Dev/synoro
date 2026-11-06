"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@synoro/ui";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { orpc } from "~/orpc/react";
import { dateKey, nextDate, zonedDayStart } from "../booking/time";
import { saveTextFile, useDataAccess } from "./data-access";

function useExportPart() {
  const access = useDataAccess();
  const mutation = useMutation({
    ...orpc.data.exportPart.mutationOptions(),
    onSuccess: ({ csv, filename }) =>
      saveTextFile(filename, csv, "text/csv;charset=utf-8"),
    onError: (error, variables) =>
      access.onError(error, () => mutation.mutate(variables)),
  });
  return { mutation, dialog: access.dialog };
}

function ClientsButton({ practiceId }: { practiceId: string }) {
  const { mutation, dialog } = useExportPart();
  return (
    <>
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ what: "clients", practiceId })}
      >
        <DownloadIcon />
        Скачать таблицу
      </Button>
      {dialog}
    </>
  );
}

function AppointmentsButton({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const { mutation, dialog } = useExportPart();
  const [open, setOpen] = useState(false);
  const today = dateKey(new Date(), timezone);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate(
      {
        what: "appointments",
        practiceId,
        from: zonedDayStart(from, timezone),
        // The last day counts too: up to the start of the next one.
        to: zonedDayStart(nextDate(to), timezone),
      },
      { onSuccess: () => setOpen(false) },
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <DownloadIcon />
        Скачать записи
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Записи за период</DialogTitle>
              <DialogDescription>
                Таблица для Excel со всеми записями, в том числе отменёнными.
                Даты в часовом поясе практики.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="export-from">С</Label>
                <Input
                  id="export-from"
                  type="date"
                  required
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="export-to">По</Label>
                <Input
                  id="export-to"
                  type="date"
                  required
                  min={from}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                Скачать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

/** A table from a list, for the practice's owner. */
export function ExportPartButton(
  props:
    | { what: "clients"; practiceId: string }
    | { what: "appointments"; practiceId: string; timezone: string },
) {
  return props.what === "clients" ? (
    <ClientsButton practiceId={props.practiceId} />
  ) : (
    <AppointmentsButton
      practiceId={props.practiceId}
      timezone={props.timezone}
    />
  );
}
