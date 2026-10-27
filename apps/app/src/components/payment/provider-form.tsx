"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PasswordInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@synoro/ui";
import {
  type PaymentAccountFormValues,
  paymentAccountFormSchema,
  TAX_SYSTEMS,
} from "@synoro/validators";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";

type Settings = RouterOutputs["payment"]["settings"];
type Provider = PaymentAccountFormValues["provider"];

export const TAX_SYSTEM_LABELS: Record<(typeof TAX_SYSTEMS)[number], string> = {
  osn: "ОСН",
  usn_income: "УСН «Доходы»",
  usn_income_outcome: "УСН «Доходы минус расходы»",
  esn: "ЕСХН",
  patent: "Патент",
};

const PROVIDERS: Record<
  Provider,
  {
    name: string;
    description: string;
    merchantLabel: string;
    merchantPlaceholder: string;
    secretLabel: string;
    help: string;
  }
> = {
  yookassa: {
    name: "ЮKassa",
    description: "Карты, СБП, SberPay, ЮMoney",
    merchantLabel: "shopId",
    merchantPlaceholder: "123456",
    secretLabel: "Секретный ключ",
    help: "Личный кабинет ЮKassa → Интеграция → Ключи API. Для проверки подойдёт тестовый магазин (ключ test_…).",
  },
  tbank: {
    name: "Т-Банк",
    description: "Интернет-эквайринг: карты, СБП, T-Pay",
    merchantLabel: "TerminalKey",
    merchantPlaceholder: "1700000000000",
    secretLabel: "Пароль терминала",
    help: "Личный кабинет Т-Бизнеса → Интернет-эквайринг → Магазины → Терминалы. Терминал должен быть одностадийным; для проверки — тестовый (…DEMO).",
  },
};

/**
 * Connect a provider or change the connected one. With the same provider
 * and shop, an empty secret keeps the saved key.
 */
export function ProviderForm({
  practiceId,
  settings,
  onSaved,
  onCancel,
}: {
  practiceId: string;
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onCancel?: () => void;
}) {
  const current = settings.account;
  const [values, setValues] = useState<PaymentAccountFormValues>({
    provider: current?.provider ?? "yookassa",
    merchantId: current?.merchantId ?? "",
    secret: "",
    receipts: current?.receipts ?? false,
    taxSystem: current?.taxSystem ?? null,
  });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const meta = PROVIDERS[values.provider];
  const keepsSecret =
    current?.provider === values.provider &&
    current.merchantId === values.merchantId.trim();

  const set = <K extends keyof PaymentAccountFormValues>(
    key: K,
    value: PaymentAccountFormValues[K],
  ) => {
    setValues((v) => ({ ...v, [key]: value }));
    setIssues((i) => ({ ...i, [key]: "" }));
  };

  const connect = useMutation({
    ...orpc.payment.connect.mutationOptions(),
    onSuccess: (data) => {
      toast.success(`${meta.name} подключена к практике`);
      onSaved(data);
    },
    onError: (error) => {
      if (!isDefinedError(error)) {
        toast.error("Не удалось подключить");
        return;
      }
      if (
        error.code === "INVALID_CREDENTIALS" ||
        error.code === "SECRET_REQUIRED"
      ) {
        setIssues({ secret: error.message });
      } else {
        toast.error(error.message);
      }
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = paymentAccountFormSchema.safeParse(values);
    if (!parsed.success) {
      setIssues(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    if (!parsed.data.secret && !keepsSecret) {
      setIssues({ secret: `Введите ${meta.secretLabel.toLowerCase()}` });
      return;
    }
    connect.mutate({ practiceId, ...parsed.data });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <RadioGroup
        value={values.provider}
        onValueChange={(value) => {
          const provider = value as Provider;
          setValues((v) => ({
            ...v,
            provider,
            merchantId:
              current?.provider === provider ? current.merchantId : "",
          }));
          setIssues({});
        }}
        aria-label="Платёжная система"
        className="grid gap-2 sm:grid-cols-2"
      >
        {(Object.keys(PROVIDERS) as Provider[]).map((key) => (
          <FieldLabel
            key={key}
            className="flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 dark:has-data-checked:bg-primary/10"
          >
            <RadioGroupItem value={key} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{PROVIDERS[key].name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {PROVIDERS[key].description}
              </span>
            </span>
          </FieldLabel>
        ))}
      </RadioGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!issues.merchantId}>
          <FieldLabel htmlFor="payment-merchant">
            {meta.merchantLabel}
          </FieldLabel>
          <Input
            id="payment-merchant"
            autoComplete="off"
            spellCheck={false}
            placeholder={meta.merchantPlaceholder}
            value={values.merchantId}
            aria-invalid={!!issues.merchantId}
            onChange={(e) => set("merchantId", e.target.value)}
          />
          <FieldError>{issues.merchantId}</FieldError>
        </Field>
        <Field data-invalid={!!issues.secret}>
          <FieldLabel htmlFor="payment-secret">{meta.secretLabel}</FieldLabel>
          <PasswordInput
            id="payment-secret"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={keepsSecret ? "Сохранён — оставьте пустым" : ""}
            value={values.secret ?? ""}
            aria-invalid={!!issues.secret}
            onChange={(e) => set("secret", e.target.value)}
          />
          <FieldError>{issues.secret}</FieldError>
        </Field>
      </div>
      <FieldDescription className="-mt-2">{meta.help}</FieldDescription>

      <div className="flex flex-col gap-3 rounded-md border p-3">
        <Field orientation="horizontal">
          <Switch
            id="payment-receipts"
            checked={values.receipts}
            onCheckedChange={(checked) => set("receipts", checked)}
          />
          <FieldLabel htmlFor="payment-receipts" className="font-normal">
            Отправлять чеки по 54-ФЗ
          </FieldLabel>
        </Field>
        <FieldDescription>
          {values.provider === "yookassa"
            ? "Включите, если в ЮKassa подключены «Чеки от ЮKassa» или онлайн-касса. Самозанятым не нужно — чек формируется в «Мой налог»."
            : "Включите, если к терминалу подключена онлайн-касса. Самозанятым не нужно — чек формируется в «Мой налог»."}
        </FieldDescription>
        {values.receipts && (
          <Field data-invalid={!!issues.taxSystem} className="max-w-xs">
            <FieldLabel htmlFor="payment-tax">
              Система налогообложения
              {values.provider === "yookassa" && " (необязательно)"}
            </FieldLabel>
            <Select
              items={TAX_SYSTEM_LABELS}
              value={values.taxSystem}
              onValueChange={(value) =>
                set("taxSystem", value as PaymentAccountFormValues["taxSystem"])
              }
            >
              <SelectTrigger id="payment-tax" className="w-full">
                <SelectValue placeholder="Выберите" />
              </SelectTrigger>
              <SelectContent>
                {TAX_SYSTEMS.map((tax) => (
                  <SelectItem key={tax} value={tax}>
                    {TAX_SYSTEM_LABELS[tax]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{issues.taxSystem}</FieldError>
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={connect.isPending}>
          {current ? "Сохранить" : "Подключить"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}
