"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from "@synoro/ui";
import { type ConsentsInput, consentPhrase } from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ErrorState } from "~/components/booking/states";
import { orpc } from "~/orpc/react";

export type ConsentDocument =
  RouterOutputs["practice"]["bySlug"]["documents"][number];

/** A name is at least two characters, as `consentsInput` asks. */
const named = (value: string) => value.trim().length >= 2;

/**
 * The documents a client accepts with a booking: which are still to accept,
 * what is ticked, and — where the practice takes minors — who consents for
 * the child. `validate()` before sending, `value()` goes into the booking
 * procedure's `consents`, `reject()` marks what the server found missing.
 */
export function useConsents(
  documents: ConsentDocument[],
  acceptsMinors: boolean,
) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [forMinor, setForMinor] = useState(false);
  const [representativeName, setRepresentativeName] = useState("");
  const [minorName, setMinorName] = useState("");
  const [namesInvalid, setNamesInvalid] = useState(false);

  const minor = acceptsMinors && forMinor;
  // What was accepted before is not asked again — but a parent accepts for a
  // child every time: the page doesn't know which child, and a consent for one
  // doesn't hold for another.
  const asked = documents.filter((d) => minor || !d.accepted);

  /** `quiet`: another message is on screen already, mark the fields only. */
  function validate(quiet = false) {
    const missing = asked.filter(
      (d) => d.required && !checked.has(d.versionId),
    );
    const names = minor && !(named(representativeName) && named(minorName));
    setInvalid(new Set(missing.map((d) => d.id)));
    setNamesInvalid(names);
    if (missing.length === 0 && !names) return true;
    if (quiet) return false;
    toast.error(
      names
        ? "Укажите ваши имя и фамилию и имя ребёнка"
        : "Отметьте согласие с документами специалиста",
    );
    return false;
  }

  function value(): ConsentsInput {
    const versionIds = asked
      .filter((d) => checked.has(d.versionId))
      .map((d) => d.versionId);
    if (versionIds.length === 0 && !minor) return undefined;
    return {
      versionIds,
      minor: minor
        ? {
            representativeName: representativeName.trim(),
            minorName: minorName.trim(),
          }
        : undefined,
    };
  }

  return {
    documents,
    acceptsMinors,
    asked,
    checked,
    invalid,
    minor,
    representativeName,
    minorName,
    namesInvalid,
    validate,
    value,
    /** The server's CONSENTS_REQUIRED: these documents are still to accept. */
    reject: (documentIds: string[]) => setInvalid(new Set(documentIds)),
    reset: () => {
      setChecked(new Set());
      setInvalid(new Set());
    },
    toggle: (document: ConsentDocument, on: boolean) => {
      const next = new Set(checked);
      if (on) next.add(document.versionId);
      else next.delete(document.versionId);
      setChecked(next);
      if (on && invalid.has(document.id)) {
        setInvalid(new Set([...invalid].filter((id) => id !== document.id)));
      }
    },
    // The ticks are for one capacity: «за себя» ticks must not turn into
    // «за ребёнка» ones (or back) when the switch is flipped.
    setForMinor: (on: boolean) => {
      setForMinor(on);
      setChecked(new Set());
      setInvalid(new Set());
    },
    setRepresentativeName,
    setMinorName,
  };
}

export type Consents = ReturnType<typeof useConsents>;

/**
 * A checkbox per document still to accept, each with its text one tap away,
 * and «Записываю ребёнка» where the practice takes minors. Nothing at all
 * for a practice without documents.
 */
export function ConsentFields({
  consents,
  idPrefix,
}: {
  consents: Consents;
  idPrefix: string;
}) {
  const [reading, setReading] = useState<ConsentDocument | null>(null);
  if (consents.documents.length === 0) return null;
  if (consents.asked.length === 0 && !consents.acceptsMinors) return null;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Документы специалиста</legend>
      {consents.acceptsMinors && (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={`${idPrefix}-minor`}
            className="mt-0.5"
            checked={consents.minor}
            onCheckedChange={(on) => consents.setForMinor(on === true)}
          />
          <Label htmlFor={`${idPrefix}-minor`} className="font-normal">
            Записываю ребёнка младше 18 лет
          </Label>
        </div>
      )}
      {consents.minor && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            За ребёнка документы принимает родитель или законный представитель.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-representative`}>
              Ваши фамилия и имя
            </Label>
            <Input
              id={`${idPrefix}-representative`}
              autoComplete="name"
              maxLength={120}
              aria-invalid={
                consents.namesInvalid && !named(consents.representativeName)
              }
              value={consents.representativeName}
              onChange={(e) => consents.setRepresentativeName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-minor-name`}>Имя ребёнка</Label>
            <Input
              id={`${idPrefix}-minor-name`}
              autoComplete="off"
              maxLength={120}
              aria-invalid={consents.namesInvalid && !named(consents.minorName)}
              value={consents.minorName}
              onChange={(e) => consents.setMinorName(e.target.value)}
            />
          </div>
        </div>
      )}
      {consents.asked.map((document) => {
        const id = `${idPrefix}-document-${document.id}`;
        const invalid = consents.invalid.has(document.id);
        return (
          <div key={document.id} className="flex flex-col gap-1">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={consents.checked.has(document.versionId)}
                aria-invalid={invalid}
                // The name is the phrase and the title: several documents
                // must not all be «Принимаю:» to a screen reader.
                aria-labelledby={`${id}-phrase ${id}-title`}
                aria-describedby={invalid ? `${id}-error` : undefined}
                onCheckedChange={(on) => consents.toggle(document, on === true)}
              />
              <span className="text-sm">
                <Label
                  id={`${id}-phrase`}
                  htmlFor={id}
                  className="inline font-normal"
                >
                  {consents.minor
                    ? `От имени ребёнка ${consentPhrase(document.kind).toLowerCase()}`
                    : consentPhrase(document.kind)}
                </Label>{" "}
                <button
                  type="button"
                  id={`${id}-title`}
                  className="text-left underline underline-offset-2 hover:text-foreground"
                  onClick={() => setReading(document)}
                >
                  {document.title}
                </button>
                {!document.required && (
                  <span className="text-muted-foreground"> (по желанию)</span>
                )}
              </span>
            </div>
            {invalid && (
              <p
                id={`${id}-error`}
                role="alert"
                className="pl-6.5 text-sm text-destructive"
              >
                Без этого согласия записаться нельзя
              </p>
            )}
          </div>
        );
      })}
      <DocumentDialog document={reading} onClose={() => setReading(null)} />
    </fieldset>
  );
}

/** The text of a document's version, to read before ticking. */
function DocumentDialog({
  document,
  onClose,
}: {
  document: ConsentDocument | null;
  onClose: () => void;
}) {
  const text = useQuery({
    ...orpc.document.read.queryOptions({
      input: { versionId: document?.versionId ?? "" },
    }),
    enabled: document !== null,
  });

  return (
    <Dialog
      open={document !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{document?.title}</DialogTitle>
          <DialogDescription>
            {text.data
              ? // The date ends with «г.»: no full stop after it.
                `${text.data.practiceName}. Версия от ${text.data.publishedAt.toLocaleDateString(
                  "ru-RU",
                  { day: "numeric", month: "long", year: "numeric" },
                )}`
              : "Документ специалиста"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {text.isError ? (
            <ErrorState onRetry={() => text.refetch()} />
          ) : text.isPending ? (
            <Skeleton className="h-48 w-full rounded-md" />
          ) : (
            <p className="text-sm break-words whitespace-pre-wrap">
              {text.data.body}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
