"use client";

import { paths } from "@synoro/config";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  ChevronRightIcon,
  Clock3Icon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageUpIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PracticeAvatar } from "./practice-avatar";
import { PracticeVideoLink } from "./practice-video-link";
import { useTerms } from "./terms";

/** Where the practice's public page is edited: photo, link, video room. */
export function PracticeBookingPage({
  practice,
}: {
  practice: {
    id: string;
    name: string;
    imageUrl: string | null;
    bookingUrl: string;
    videoUrl: string | null;
    membership: { role: string };
  };
}) {
  const terms = useTerms();
  const isOwner = practice.membership.role === "owner";
  const [imageUrl, setImageUrl] = useState(practice.imageUrl);
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
        {!isOwner && (
          <Alert variant="info">
            <ImageUpIcon />
            <AlertTitle>Страницу записи настраивает владелец</AlertTitle>
            <AlertDescription>
              Фото и видеовстречу меняет владелец практики. Ссылкой можно
              делиться.
            </AlertDescription>
          </Alert>
        )}

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

        {isOwner && (
          <Frame spacing="default" className="min-w-0">
            <PracticeVideoLink
              practiceId={practice.id}
              videoUrl={practice.videoUrl}
            />
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
        <div className="flex flex-col gap-5 rounded-xl border bg-card p-6">
          <Avatar className="size-16">
            {imageUrl && <AvatarImage src={imageUrl} alt={practice.name} />}
            <AvatarFallback className="text-lg font-medium">
              {practice.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">
              {practice.name}
            </span>
            <span className="text-xl font-semibold tracking-tight">
              {terms.credit[0].charAt(0).toUpperCase() +
                terms.credit[0].slice(1)}
            </span>
          </div>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3Icon className="size-4" />1 час
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Фото сохраняется сразу после загрузки.
        </p>
      </aside>
    </div>
  );
}
