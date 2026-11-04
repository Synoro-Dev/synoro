"use client";

import { paths } from "@synoro/config";
import { Button, Input, toast } from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  type BookingTheme,
  capitalize,
  DEFAULT_BOOKING_THEME,
} from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";

import { PracticeAvatar } from "./practice-avatar";
import { PracticeBookingQuestions } from "./practice-booking-questions";
import {
  BookingThemePreview,
  PracticeBookingTheme,
} from "./practice-booking-theme";
import { PracticeFreeBooking } from "./practice-free-booking";
import { PracticeVideoLink } from "./practice-video-link";
import { useTerms } from "./terms";

/**
 * Where the practice's public page is edited: photo, link, free intro,
 * video room, the questionnaire clients fill in when booking and the page's
 * look, previewed beside the settings. Administrators share the link and
 * design the page; the rest is the owner's.
 */
export function PracticeBookingPage({
  practice,
}: {
  practice: {
    id: string;
    name: string;
    imageUrl: string | null;
    bookingUrl: string;
    videoUrl: string | null;
    freeBookingEnabled: boolean;
    introMinutes: number;
    membership: { role: string };
  };
}) {
  const terms = useTerms();
  const isOwner = practice.membership.role === "owner";
  const [imageUrl, setImageUrl] = useState(practice.imageUrl);
  const saved = useQuery(
    orpc.practice.theme.queryOptions({ input: { practiceId: practice.id } }),
  );
  /** The look being edited, until it is saved or the page is left. */
  const [draft, setDraft] = useState<BookingTheme | null>(null);
  // Without the owner's «Про» clients see the default look.
  const theme =
    draft ??
    (saved.data?.pro ? saved.data.theme : null) ??
    DEFAULT_BOOKING_THEME;
  const publicUrl = practice.bookingUrl;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.info(text);
    }
  }

  /** The booking page in an iframe, to paste into the practice's own site. */
  const embed = `<iframe src="${publicUrl}" title="Онлайн-запись" style="width:100%;height:720px;border:0" loading="lazy"></iframe>`;

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {isOwner && (
          <Frame spacing="default" className="min-w-0">
            <FramePanel className="flex flex-col gap-4">
              <FrameHeader className="p-0">
                <FrameTitle>Фото специалиста</FrameTitle>
                <FrameDescription>
                  Показывается слева на странице записи
                </FrameDescription>
              </FrameHeader>
              <PracticeAvatar
                practiceId={practice.id}
                name={practice.name}
                imageUrl={imageUrl}
                onChange={setImageUrl}
              />
            </FramePanel>
          </Frame>
        )}

        <Frame spacing="default" className="min-w-0">
          <FramePanel className="flex flex-col gap-4">
            <FrameHeader className="p-0">
              <FrameTitle>Ссылка для клиентов</FrameTitle>
              <FrameDescription>
                Записаться можно без регистрации — отправьте ссылку или встройте
                форму на свой сайт
              </FrameDescription>
            </FrameHeader>
            <div className="flex gap-2">
              <Input
                readOnly
                value={publicUrl}
                aria-label="Ссылка для записи"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Скопировать ссылку"
                onClick={() => copy(publicUrl, "Ссылка скопирована")}
              >
                <CopyIcon />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Открыть страницу записи"
                nativeButton={false}
                render={<a href={publicUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon />
              </Button>
            </div>
            <Button
              variant="outline"
              className="self-start"
              onClick={() =>
                copy(embed, "Код скопирован — вставьте его на свой сайт")
              }
            >
              <CodeIcon />
              Скопировать код для сайта
            </Button>
          </FramePanel>
        </Frame>

        <Frame spacing="default" className="min-w-0">
          <PracticeBookingTheme
            practiceId={practice.id}
            name={practice.name}
            draft={draft}
            setDraft={setDraft}
          />
        </Frame>

        {isOwner && (
          <Frame spacing="default" className="min-w-0">
            <PracticeFreeBooking
              practiceId={practice.id}
              enabled={practice.freeBookingEnabled}
              introMinutes={practice.introMinutes}
            />
          </Frame>
        )}

        {isOwner && (
          <Frame spacing="default" className="min-w-0">
            <PracticeVideoLink
              practiceId={practice.id}
              videoUrl={practice.videoUrl}
            />
          </Frame>
        )}

        {isOwner && (
          <Frame spacing="default" className="min-w-0">
            <PracticeBookingQuestions practiceId={practice.id} />
          </Frame>
        )}

        {isOwner && (
          <Link
            href={paths.booking.domain(practice.id)}
            className="flex items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted dark:hover:bg-muted/50"
          >
            <GlobeIcon className="size-5 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">Свой домен</span>
              <span className="text-xs text-muted-foreground">
                Страница записи по вашему адресу, например anna-psy.ru
              </span>
            </div>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
        <span className="text-sm font-medium">Так видят клиенты</span>
        <BookingThemePreview
          theme={theme}
          name={practice.name}
          imageUrl={imageUrl}
          what={capitalize(terms.credit[0])}
        />
        <p className="text-xs text-muted-foreground">
          {draft && JSON.stringify(draft) !== JSON.stringify(saved.data?.theme)
            ? "Это ещё не сохранено: клиенты видят прежнее оформление."
            : "Фото сохраняется сразу после загрузки."}
        </p>
      </aside>
    </div>
  );
}
