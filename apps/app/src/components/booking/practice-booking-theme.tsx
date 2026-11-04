"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  BOOKING_ACCENT_LABELS,
  BOOKING_ACCENTS,
  BOOKING_BACKDROP_LABELS,
  BOOKING_BACKDROPS,
  BOOKING_FONT_LABELS,
  BOOKING_FONTS,
  BOOKING_RADII,
  BOOKING_RADIUS_LABELS,
  type BookingTheme,
  bookingThemeSchema,
  DEFAULT_BOOKING_THEME,
  isDefaultBookingTheme,
  MAX_BOOKING_ABOUT,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";

import { orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { SaveState } from "../settings/save-state";
import { bookingThemeAttributes } from "./booking-theme";
import { displayFonts } from "./display-font";
import { ErrorState } from "./states";

/** A choice card: the pattern of the guest form's packages. */
const CHOICE =
  "flex w-full cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 dark:has-data-checked:bg-primary/10";

/** The look being edited; null while it is the saved one. */
type Draft = {
  draft: BookingTheme | null;
  setDraft: Dispatch<SetStateAction<BookingTheme | null>>;
};

/**
 * How the booking page looks («Про»): accent, headings' face, corners,
 * backdrop and a line about the specialist. Anyone on staff may try the
 * presets — the parent keeps the draft and previews it beside the editor —
 * but only the owner's «Про» publishes them.
 */
export function PracticeBookingTheme({
  practiceId,
  name,
  draft,
  setDraft,
}: { practiceId: string; name: string } & Draft) {
  const settings = useQuery(
    orpc.practice.theme.queryOptions({ input: { practiceId } }),
  );

  if (settings.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (settings.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить оформление."
        onRetry={() => settings.refetch()}
      />
    );
  }
  return (
    <Editor
      practiceId={practiceId}
      pro={settings.data.pro}
      saved={settings.data.theme}
      name={name}
      draft={draft}
      setDraft={setDraft}
    />
  );
}

function Editor({
  practiceId,
  pro,
  saved,
  name,
  draft,
  setDraft,
}: {
  practiceId: string;
  pro: boolean;
  saved: BookingTheme;
  name: string;
} & Draft) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const theme = draft ?? saved;

  const save = useMutation({
    ...orpc.practice.setTheme.mutationOptions(),
    onSuccess: async ({ theme }) => {
      setSavedAt(Date.now());
      toast.success(
        isDefaultBookingTheme(theme)
          ? "Вернули оформление по умолчанию"
          : "Оформление сохранено — клиенты уже видят его",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (e) => toast.error(e.message),
  });

  const changed = JSON.stringify(theme) !== JSON.stringify(saved);
  const isDefault = isDefaultBookingTheme(theme);
  // Without «Про» only the default look can be saved.
  const canSave = changed && (pro || isDefault);

  function patch(change: Partial<BookingTheme>) {
    setDraft((current) => ({ ...(current ?? saved), ...change }));
    setError(undefined);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = bookingThemeSchema.safeParse(theme);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте оформление");
      return;
    }
    const sent = draft;
    save.mutate(
      { practiceId, theme: parsed.data },
      {
        // The saved look takes over, unless the editing went on meanwhile.
        onSuccess: () =>
          setDraft((current) => (current === sent ? null : current)),
      },
    );
  }

  return (
    <FramePanel>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <FrameHeader className="p-0">
          <FrameTitle className="flex flex-wrap items-center gap-2">
            Оформление страницы
            {!isDefaultBookingTheme(saved) && (
              <Badge variant={pro ? "success-light" : "warning-light"}>
                {pro ? "Своё" : "Не видно без «Про»"}
              </Badge>
            )}
          </FrameTitle>
          <FrameDescription>
            Цвет, шрифт и пара слов о себе — чтобы страница записи выглядела как
            ваша, а не как сервис.
          </FrameDescription>
        </FrameHeader>

        {pro ? null : <ProRequired feature="Своё оформление страницы" />}

        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            Цвет акцента
          </FieldLegend>
          <RadioGroup
            value={theme.accent}
            onValueChange={(value) =>
              patch({ accent: value as BookingTheme["accent"] })
            }
            className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2"
          >
            {BOOKING_ACCENTS.map((accent) => (
              <FieldLabel key={accent} className={CHOICE}>
                <RadioGroupItem
                  value={accent}
                  aria-label={BOOKING_ACCENT_LABELS[accent]}
                />
                <span
                  aria-hidden
                  data-booking-accent={accent}
                  className="size-4 shrink-0 rounded-full bg-primary"
                />
                <span className="min-w-0 truncate font-normal">
                  {BOOKING_ACCENT_LABELS[accent]}
                </span>
              </FieldLabel>
            ))}
          </RadioGroup>
          <FieldDescription>
            Кнопки, выбранный день и время, ссылки
          </FieldDescription>
        </FieldSet>

        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            Шрифт заголовков
          </FieldLegend>
          <RadioGroup
            value={theme.font}
            onValueChange={(value) =>
              patch({ font: value as BookingTheme["font"] })
            }
            className={cn(
              displayFonts,
              "grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2",
            )}
          >
            {BOOKING_FONTS.map((font) => (
              <FieldLabel key={font} className={CHOICE}>
                <RadioGroupItem
                  value={font}
                  aria-label={BOOKING_FONT_LABELS[font]}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    data-booking-font={font}
                    className="truncate font-display text-xl font-medium tracking-tight"
                  >
                    {name}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {BOOKING_FONT_LABELS[font]}
                  </span>
                </span>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>

        <div className="flex flex-wrap gap-x-8 gap-y-6">
          <Field className="w-auto">
            <FieldLabel id="theme-radius">Углы</FieldLabel>
            <ToggleGroup
              variant="outline"
              value={[theme.radius]}
              onValueChange={(value) => {
                const next = BOOKING_RADII.find((r) => r === value[0]);
                if (next) patch({ radius: next });
              }}
              aria-labelledby="theme-radius"
            >
              {BOOKING_RADII.map((radius) => (
                <ToggleGroupItem key={radius} value={radius}>
                  {BOOKING_RADIUS_LABELS[radius]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field className="w-auto">
            <FieldLabel id="theme-backdrop">Фон страницы</FieldLabel>
            <ToggleGroup
              variant="outline"
              value={[theme.backdrop]}
              onValueChange={(value) => {
                const next = BOOKING_BACKDROPS.find((b) => b === value[0]);
                if (next) patch({ backdrop: next });
              }}
              aria-labelledby="theme-backdrop"
            >
              {BOOKING_BACKDROPS.map((backdrop) => (
                <ToggleGroupItem key={backdrop} value={backdrop}>
                  {BOOKING_BACKDROP_LABELS[backdrop]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="theme-about">О себе</FieldLabel>
          <Textarea
            id="theme-about"
            rows={3}
            maxLength={MAX_BOOKING_ABOUT}
            placeholder="Например: готовлю к ЕГЭ по математике. Встречи онлайн, по будням с 16 до 21."
            value={theme.about}
            onChange={(e) => patch({ about: e.target.value })}
          />
          <FieldDescription className="flex justify-between gap-4">
            <span>Под вашим именем на странице записи</span>
            <span className="tabular-nums">
              {theme.about.length}/{MAX_BOOKING_ABOUT}
            </span>
          </FieldDescription>
        </Field>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!canSave || save.isPending}>
            Сохранить оформление
          </Button>
          <SaveState dirty={changed} savedAt={savedAt} />
          {!isDefault && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => patch(DEFAULT_BOOKING_THEME)}
            >
              <RotateCcwIcon />
              Как было по умолчанию
            </Button>
          )}
          {!pro && changed && !isDefault && (
            <span className="text-xs text-muted-foreground">
              Попробовать можно, сохранить — с «Про»
            </span>
          )}
        </div>
      </form>
    </FramePanel>
  );
}

/**
 * The booking page in miniature with a theme on: the specialist, a day of
 * free times and the button. Not interactive.
 */
export function BookingThemePreview({
  theme,
  name,
  imageUrl,
  what,
  free,
}: {
  theme: BookingTheme;
  name: string;
  imageUrl: string | null;
  /** «Консультация», «Занятие»… */
  what: string;
  /** The free intro's name, when clients book it themselves. */
  free: string | null;
}) {
  const times = ["10:00", "11:00", "13:00", "15:00", "17:00", "18:00"];
  return (
    <div
      inert
      {...bookingThemeAttributes(theme)}
      className={cn(
        displayFonts,
        "flex flex-col gap-4 rounded-xl border bg-background p-4",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          {imageUrl && <AvatarImage src={imageUrl} alt="" />}
          <AvatarFallback className="font-display">
            {Array.from(name)[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-display text-lg leading-tight font-medium tracking-tight">
            {name}
          </span>
          <span className="text-xs text-muted-foreground">{what}, 1 час</span>
          {free && (
            <span className="text-xs text-muted-foreground">
              {free} — бесплатно
            </span>
          )}
        </div>
      </div>
      {theme.about && (
        <p className="line-clamp-4 text-xs whitespace-pre-line">
          {theme.about}
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs">
        <span className="font-display text-base font-medium tracking-tight">
          Среда, 12 ноября
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {times.map((time, index) => (
            <Button
              key={time}
              tabIndex={-1}
              size="sm"
              variant={index === 1 ? "default" : "outline"}
              className="tabular-nums"
            >
              {time}
            </Button>
          ))}
        </div>
        <Button tabIndex={-1} size="sm">
          Записаться
        </Button>
      </div>
    </div>
  );
}
