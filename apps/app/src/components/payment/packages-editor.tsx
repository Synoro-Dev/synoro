"use client";

import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@synoro/ui/reui/number-field";
import { paymentPackagesFormSchema } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "../booking/states";
import { useTerms } from "../booking/terms";
import { SaveState } from "../settings/save-state";
import { formatRub, packageDeals } from "./format";

interface Row {
  key: number;
  credits: number | null;
  /** Rubles as typed. */
  price: string;
}

/** Next usual package size after the ones already listed. */
const SIZES = [1, 5, 10, 4, 8, 3, 12, 20];

let nextKey = 0;
const row = (credits: number | null, price = ""): Row => ({
  key: nextKey++,
  credits,
  price,
});

const toKopecks = (rubles: string) =>
  Math.round(Number(rubles.replace(/\s/g, "").replace(",", ".")) * 100);

/** What the rows say, whatever their keys: to tell a draft from the saved. */
const snapshot = (rows: Row[]) =>
  JSON.stringify(rows.map((r) => [r.credits, r.price.trim()]));

interface EditorEvents {
  /**
   * The form's id when a surrounding step saves it with its own button: the
   * form then shows no button or status of its own.
   */
  formId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}

/** The price list clients buy from: package size and its price. */
export function PackagesEditor({
  practiceId,
  ...events
}: { practiceId: string } & EditorEvents) {
  const offer = useQuery(
    orpc.payment.packages.queryOptions({ input: { practiceId } }),
  );
  if (offer.isError) return <ErrorState onRetry={() => offer.refetch()} />;
  if (offer.isPending) return <Skeleton className="h-40 w-full rounded-md" />;
  return (
    <Editor
      practiceId={practiceId}
      initial={
        offer.data.packages.length
          ? offer.data.packages.map((p) =>
              row(p.credits, String(p.price / 100)),
            )
          : [row(1)]
      }
      {...events}
    />
  );
}

function Editor({
  practiceId,
  initial,
  formId,
  onDirtyChange,
  onSaved,
}: {
  practiceId: string;
  initial: Row[];
} & EditorEvents) {
  const queryClient = useQueryClient();
  const terms = useTerms();
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(() => snapshot(initial));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const dirty = snapshot(rows) !== saved;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const update = (key: number, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
    setError(undefined);
  };

  const save = useMutation({
    ...orpc.payment.savePackages.mutationOptions(),
    onSuccess: async () => {
      setSaved(snapshot(rows));
      setSavedAt(Date.now());
      toast.success("Цены сохранены");
      await queryClient.invalidateQueries({
        queryKey: orpc.payment.packages.key(),
      });
      onSaved?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const priced = rows.flatMap((r) =>
    r.credits && toKopecks(r.price) > 0
      ? [{ key: r.key, credits: r.credits, price: toKopecks(r.price) }]
      : [],
  );
  const deals = new Map(packageDeals(priced).map((d) => [d.key, d]));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = paymentPackagesFormSchema.safeParse({
      packages: rows.map((r) => ({
        credits: r.credits ?? Number.NaN,
        price: toKopecks(r.price),
      })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте цены");
      return;
    }
    save.mutate({ practiceId, packages: parsed.data.packages });
  }

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="hidden grid-cols-[8.5rem_10rem_1fr_2.25rem] gap-3 text-xs text-muted-foreground sm:grid">
          <span className="first-letter:uppercase">{terms.credit[2]}</span>
          <span>Цена пакета</span>
        </div>
      )}
      {rows.map((r) => {
        const deal = deals.get(r.key);
        return (
          <div
            key={r.key}
            className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[8.5rem_10rem_1fr_2.25rem]"
          >
            <NumberField
              value={r.credits}
              onValueChange={(credits) => update(r.key, { credits })}
              min={1}
              max={100}
              aria-label={`Сколько ${terms.credit[2]} в пакете`}
            >
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Удалить пакет"
              className="sm:order-last"
              onClick={() =>
                setRows((current) => current.filter((x) => x.key !== r.key))
              }
            >
              <Trash2Icon />
            </Button>
            <InputGroup>
              <InputGroupInput
                inputMode="decimal"
                placeholder="3 000"
                aria-label="Цена пакета, ₽"
                value={r.price}
                onChange={(e) => update(r.key, { price: e.target.value })}
              />
              <InputGroupAddon align="inline-end">₽</InputGroupAddon>
            </InputGroup>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {deal && r.credits && r.credits > 1 && (
                <>
                  {formatRub(deal.unitPrice)} за {terms.creditAccusative}
                  {deal.discount > 0 && (
                    <Badge variant="success-light">−{deal.discount}%</Badge>
                  )}
                </>
              )}
              {deal && r.credits === 1 && `за 1 ${terms.creditAccusative}`}
            </span>
          </div>
        );
      })}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= 10}
          onClick={() => {
            const taken = new Set(rows.map((r) => r.credits));
            setRows([
              ...rows,
              row(SIZES.find((size) => !taken.has(size)) ?? null),
            ]);
          }}
        >
          <PlusIcon />
          Добавить пакет
        </Button>
        {!formId && (
          <>
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              Сохранить цены
            </Button>
            <SaveState dirty={dirty} savedAt={savedAt} />
          </>
        )}
      </div>
    </form>
  );
}
