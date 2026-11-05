"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@synoro/ui";
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
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";

import { BookingLinkActions } from "./booking-link";
import { PracticeAddress } from "./practice-address";
import { PracticeAvatar } from "./practice-avatar";
import {
  BookingThemePreview,
  PracticeBookingTheme,
} from "./practice-booking-theme";
import { PracticeFreeBooking } from "./practice-free-booking";
import { PracticeVideoLink } from "./practice-video-link";
import { useTerms } from "./terms";

/**
 * Where the practice's public page is edited: photo, link, address, free
 * intro, video room and the page's look, with a live preview «как видит
 * клиент» — beside the settings where they fit, on a narrow screen a panel
 * that stays in view. Administrators share the link and design the page; the
 * rest is the owner's.
 */
export function PracticeBookingPage({
  practice,
}: {
  practice: {
    id: string;
    name: string;
    slug: string;
    formerSlugs: string[];
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
  const [freeEnabled, setFreeEnabled] = useState(practice.freeBookingEnabled);
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

  const preview = (
    <>
      <BookingThemePreview
        theme={theme}
        name={practice.name}
        imageUrl={imageUrl}
        what={capitalize(terms.credit[0])}
        free={freeEnabled ? terms.free : null}
      />
      <p className="text-xs text-muted-foreground">
        {draft && JSON.stringify(draft) !== JSON.stringify(saved.data?.theme)
          ? "Это ещё не сохранено: клиенты видят прежнее оформление."
          : "Фото сохраняется сразу после загрузки."}
      </p>
      <a
        href={practice.bookingUrl}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-8 w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        Открыть настоящую страницу
      </a>
    </>
  );

  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 gap-6 @[52rem]:grid-cols-[minmax(0,1fr)_20rem]">
        <Collapsible className="sticky top-14 z-[5] rounded-xl border bg-card @[52rem]:hidden">
          <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&[data-panel-open]>svg]:rotate-180">
            Как видит клиент
            <ChevronDownIcon
              className="size-4 text-muted-foreground transition-transform"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="max-h-[60svh] overflow-y-auto">
            <div className="flex flex-col gap-2 px-4 pb-4">{preview}</div>
          </CollapsibleContent>
        </Collapsible>

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
                  Записаться можно без регистрации — отправьте ссылку или
                  встройте форму на свой сайт
                </FrameDescription>
              </FrameHeader>
              <BookingLinkActions url={practice.bookingUrl} />
            </FramePanel>
          </Frame>

          {isOwner && (
            <Frame spacing="default" className="min-w-0">
              <PracticeAddress
                practiceId={practice.id}
                slug={practice.slug}
                formerSlugs={practice.formerSlugs}
                bookingUrl={practice.bookingUrl}
              />
            </Frame>
          )}

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
                onEnabledChange={setFreeEnabled}
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
        </div>

        <aside className="hidden min-w-0 flex-col gap-2 @[52rem]:sticky @[52rem]:top-20 @[52rem]:flex @[52rem]:self-start">
          <span className="text-sm font-medium">Как видит клиент</span>
          {preview}
        </aside>
      </div>
    </div>
  );
}
