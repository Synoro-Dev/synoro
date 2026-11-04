"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isDefinedError } from "@orpc/client";
import type { paths } from "@synoro/config";
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Spinner,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  isPremiumSlug,
  PREMIUM_SLUG_PRICE_LABEL,
  type PracticeSlugFormValues,
  practiceSlugFormSchema,
  practiceSlugSchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FlaskConicalIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { orpc } from "~/orpc/react";

/** ~2 minutes of checks, then the webhook takes it from there. */
const MAX_CHECKS = 48;

/**
 * Back from the Точка payment page (`?order=<id>`): checks the order until
 * the bank settles it and says what happened.
 */
function OrderReturn() {
  const orderId = useSearchParams().get("order");
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const options = orpc.practice.slugOrder.queryOptions({
    input: { orderId: orderId ?? "" },
  });
  const order = useQuery({
    ...options,
    enabled: !!orderId,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" &&
      query.state.dataUpdateCount < MAX_CHECKS
        ? 2500
        : false,
  });

  const status = order.data?.status;
  useEffect(() => {
    if (status !== "succeeded") return;
    void queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    // The link on this page and in the sidebar come from the server.
    router.refresh();
  }, [status, queryClient, router]);

  // Точка's sandbox links can't be paid: play the bank here instead.
  const sandboxPay = useMutation({
    ...orpc.practice.slugOrderSandboxPay.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
    onError: () => toast.error("Не удалось подтвердить тестовый платёж"),
  });

  if (!orderId || order.isError) return null;

  const dismiss = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Скрыть"
      className="absolute top-2 right-2"
      onClick={() =>
        router.replace(pathname as ReturnType<typeof paths.booking.page>)
      }
    >
      <XIcon />
    </Button>
  );

  if (order.data?.status === "pending" && order.data.sandbox) {
    return (
      <Alert variant="warning">
        <FlaskConicalIcon />
        <AlertTitle>Тестовая оплата</AlertTitle>
        <AlertDescription>
          <p>
            Песочница Точки не принимает платежи, деньги не списываются.
            Подтвердите оплату сами — адрес сменится так же, как после
            настоящей.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={sandboxPay.isPending}
              onClick={() =>
                sandboxPay.mutate({ orderId, outcome: "succeeded" })
              }
            >
              {sandboxPay.isPending && <Spinner />}
              Оплатить
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sandboxPay.isPending}
              onClick={() =>
                sandboxPay.mutate({ orderId, outcome: "canceled" })
              }
            >
              Отказаться
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (!order.data || order.data.status === "pending") {
    const checks =
      queryClient.getQueryState(options.queryKey)?.dataUpdateCount ?? 0;
    const slow = checks >= MAX_CHECKS;
    return (
      <Alert variant="info" className="relative pr-12">
        <Spinner />
        <AlertTitle>
          {slow ? "Платёж ещё обрабатывается" : "Проверяем оплату…"}
        </AlertTitle>
        <AlertDescription>
          {slow
            ? "Адрес сменится автоматически, как только банк подтвердит оплату."
            : "Обычно это занимает несколько секунд."}
        </AlertDescription>
        {slow && dismiss}
      </Alert>
    );
  }

  if (order.data.status === "succeeded") {
    return (
      <Alert variant="success" className="relative pr-12">
        <CircleCheckIcon />
        <AlertTitle>Оплата прошла, спасибо!</AlertTitle>
        <AlertDescription>
          Адрес /{order.data.slug} теперь ваш. Чек придёт на почту.
        </AlertDescription>
        {dismiss}
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="relative pr-12">
      <CircleAlertIcon />
      <AlertTitle>Оплата не прошла</AlertTitle>
      <AlertDescription>
        Деньги не списаны. Попробуйте ещё раз, другой картой или через СБП.
      </AlertDescription>
      {dismiss}
    </Alert>
  );
}

function AddressForm({
  practiceId,
  slug,
  host,
}: {
  practiceId: string;
  slug: string;
  host: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<PracticeSlugFormValues>({
    resolver: zodResolver(practiceSlugFormSchema),
    defaultValues: { slug },
  });
  const { errors } = form.formState;

  const typed = practiceSlugSchema.safeParse(
    useWatch({ control: form.control, name: "slug" }),
  );
  const unchanged = typed.success && typed.data === slug;
  const premium = typed.success && !unchanged && isPremiumSlug(typed.data);

  const save = useMutation({
    ...orpc.practice.setSlug.mutationOptions(),
    onSuccess: async (result) => {
      if (result.status === "payment") {
        window.location.assign(result.confirmationUrl);
        return;
      }
      toast.success("Адрес изменён");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      // The link on this page and in the sidebar come from the server.
      router.refresh();
    },
    onError: (error) => {
      if (
        isDefinedError(error) &&
        (error.code === "CONFLICT" || error.code === "PREMIUM_UNAVAILABLE")
      ) {
        form.setError("slug", { message: error.message });
        return;
      }
      toast.error(error.message || "Не удалось изменить адрес");
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) =>
        save.mutate({ practiceId, slug: values.slug }),
      )}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="practice-address">Адрес</Label>
        <InputGroup aria-invalid={!!errors.slug}>
          <InputGroupAddon>{host}/</InputGroupAddon>
          <InputGroupInput
            id="practice-address"
            aria-invalid={!!errors.slug}
            {...form.register("slug")}
          />
        </InputGroup>
        {errors.slug ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.slug.message}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {premium
              ? `Короткий адрес — премиум-имя. Стоит ${PREMIUM_SLUG_PRICE_LABEL}, платить нужно один раз. Адрес сменится сразу после оплаты.`
              : `Адрес от 5 символов бесплатный. Короткий, из 3–4 символов, — премиум-имя за ${PREMIUM_SLUG_PRICE_LABEL}.`}
          </p>
        )}
      </div>
      <Button
        type="submit"
        className="self-start"
        disabled={save.isPending || unchanged}
      >
        {save.isPending && <Spinner />}
        {premium ? `Оплатить ${PREMIUM_SLUG_PRICE_LABEL}` : "Сохранить адрес"}
      </Button>
    </form>
  );
}

/**
 * The address of the booking page, owner only. Short addresses are bought
 * once (`practice.setSlug`); the old address keeps leading to the page.
 */
export function PracticeAddress({
  practiceId,
  slug,
  bookingUrl,
}: {
  practiceId: string;
  slug: string;
  bookingUrl: string;
}) {
  return (
    <FramePanel className="flex flex-col gap-4">
      <FrameHeader className="p-0">
        <FrameTitle>Адрес страницы</FrameTitle>
        <FrameDescription>
          Старая ссылка продолжит работать: она приведёт клиентов на новый адрес
        </FrameDescription>
      </FrameHeader>
      <Suspense fallback={null}>
        <OrderReturn />
      </Suspense>
      <AddressForm
        // Re-seed the field when the saved address changes.
        key={slug}
        practiceId={practiceId}
        slug={slug}
        host={new URL(bookingUrl).host}
      />
    </FramePanel>
  );
}
