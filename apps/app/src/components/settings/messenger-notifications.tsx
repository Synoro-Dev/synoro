"use client";

import { isDefinedError } from "@orpc/client";
import { Button, Skeleton, Spinner, toast } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { MESSENGER_LABELS, type Messenger } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRingIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  MessageCircleIcon,
  SendIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { ErrorState } from "../booking/states";

/**
 * A start link lives 15 minutes; checks go on a little longer, for one
 * opened at the last moment.
 */
const WAIT_MS = 15 * 60 * 1000 + 15_000;

const ICONS: Record<Messenger, typeof SendIcon> = {
  telegram: SendIcon,
  max: MessageCircleIcon,
};

/**
 * Linking the user's Telegram or MAX for notices («Про»): a button per
 * messenger gives a one-time start link, then the status is checked until
 * the bot confirms the chat.
 */
function Connect({
  messengers,
  chat,
}: {
  messengers: Messenger[];
  chat: {
    messenger: Messenger;
    username: string | null;
    blocked: boolean;
  } | null;
}) {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState<{
    messenger: Messenger;
    url: string;
    since: number;
    /** The link ran out before the bot confirmed the chat. */
    expired: boolean;
  } | null>(null);

  useEffect(() => {
    if (!waiting || waiting.expired) return;
    const timer = setTimeout(
      () => setWaiting((w) => w && { ...w, expired: true }),
      waiting.since + WAIT_MS - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [waiting]);

  // The bot links the chat on its side: check until it shows up.
  const linked = useQuery({
    ...orpc.messenger.status.queryOptions(),
    enabled: waiting !== null && !waiting.expired,
    refetchInterval: (query) => {
      if (!waiting || waiting.expired) return false;
      const now = query.state.data?.chat;
      return now?.messenger === waiting.messenger && !now.blocked
        ? false
        : 3000;
    },
  });
  const done =
    waiting !== null &&
    linked.data?.chat?.messenger === waiting.messenger &&
    !linked.data.chat.blocked &&
    linked.dataUpdatedAt > waiting.since;
  useEffect(() => {
    if (!done || !waiting) return;
    toast.success(`${MESSENGER_LABELS[waiting.messenger]} подключён`);
    setWaiting(null);
  }, [done, waiting]);

  const link = useMutation({
    ...orpc.messenger.link.mutationOptions(),
    onSuccess: ({ url }, { messenger }) =>
      setWaiting({ messenger, url, since: Date.now(), expired: false }),
    onError: (error) =>
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось получить ссылку",
      ),
  });

  const unlink = useMutation({
    ...orpc.messenger.unlink.mutationOptions(),
    onSuccess: async () => {
      toast.success("Уведомления снова приходят на почту");
      await queryClient.invalidateQueries({ queryKey: orpc.messenger.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  if (waiting?.expired) {
    const { messenger } = waiting;
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">
          Ссылка истекла, а бот так и не ответил. Получите новую и откройте её в{" "}
          {MESSENGER_LABELS[messenger]}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={link.isPending}
            onClick={() => link.mutate({ messenger })}
          >
            {link.isPending && <Spinner />}
            Новая ссылка
          </Button>
          <Button variant="ghost" onClick={() => setWaiting(null)}>
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  if (waiting) {
    const label = MESSENGER_LABELS[waiting.messenger];
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">
          Откройте бота Synoro в {label} и нажмите «Запустить» — бот ответит,
          что всё готово. Ссылка действует 15 минут.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            nativeButton={false}
            render={
              <a href={waiting.url} target="_blank" rel="noopener noreferrer" />
            }
          >
            <ExternalLinkIcon />
            Открыть {label}
          </Button>
          <Button variant="ghost" onClick={() => setWaiting(null)}>
            Отмена
          </Button>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            Ждём ответа бота
          </span>
        </div>
      </div>
    );
  }

  const buttons = messengers.map((messenger) => {
    const Icon = ICONS[messenger];
    const pending = link.isPending && link.variables?.messenger === messenger;
    return (
      <Button
        key={messenger}
        variant="outline"
        disabled={link.isPending}
        onClick={() => link.mutate({ messenger })}
      >
        {pending ? <Spinner /> : <Icon />}
        Подключить {MESSENGER_LABELS[messenger]}
      </Button>
    );
  });

  if (!chat) {
    return <div className="flex flex-wrap gap-2">{buttons}</div>;
  }

  const Icon = ICONS[chat.messenger];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile variant="soft" aria-hidden="true">
          <Icon />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">
            {MESSENGER_LABELS[chat.messenger]} подключён
          </span>
          {chat.username && (
            <span className="truncate text-xs text-muted-foreground">
              @{chat.username}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate(undefined)}
        >
          {unlink.isPending && <Spinner />}
          Отключить
        </Button>
      </div>
      {chat.blocked && (
        <Alert variant="warning">
          <CircleAlertIcon />
          <AlertTitle>Бот не может вам написать</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              Похоже, бот остановлен или заблокирован — пока уведомления
              приходят на почту. Подключите мессенджер заново.
            </span>
            {buttons.length > 0 && (
              <div className="flex flex-wrap gap-2">{buttons}</div>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

const DESCRIPTION =
  "Напоминания о встречах, подтверждения и отмены записей — в Telegram или MAX вместо почты. Если бот не сможет написать, придёт письмо.";

/** Settings → Уведомления: the messenger, or why it isn't available. */
export function MessengerSettings() {
  const status = useQuery(orpc.messenger.status.queryOptions());

  let content: React.ReactNode;
  if (status.isError) {
    content = <ErrorState onRetry={() => status.refetch()} />;
  } else if (status.isPending) {
    content = <Skeleton className="h-10 w-64 rounded-md" />;
  } else if (status.data.messengers.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        Мессенджеры пока не подключены к Synoro — уведомления приходят на почту.
      </p>
    );
  } else if (!status.data.available) {
    // Without «Про» a linked chat waits; it can still be unlinked.
    content = (
      <div className="flex flex-col gap-4">
        {status.data.chat && (
          <Connect messengers={[]} chat={status.data.chat} />
        )}
        {status.data.owner ? (
          <ProRequired feature="Уведомления в Telegram и MAX" />
        ) : (
          <p className="text-sm text-muted-foreground">
            Уведомления в мессенджере работают, когда у вашего специалиста тариф
            «Про». Пока всё приходит на почту.
          </p>
        )}
      </div>
    );
  } else {
    content = (
      <Connect messengers={status.data.messengers} chat={status.data.chat} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Уведомления в мессенджере
        </h2>
        <p className="text-sm text-muted-foreground">{DESCRIPTION}</p>
      </div>
      {content}
    </div>
  );
}

/**
 * The same in the client's cabinet, where it works (a practice of theirs is
 * on «Про» and a bot is set up) or a chat is linked and can be unlinked.
 * Hidden otherwise.
 */
export function MessengerCard() {
  const status = useQuery(orpc.messenger.status.queryOptions());
  const data = status.data;
  const canLink = !!data?.available && data.messengers.length > 0;
  if (!data || (!canLink && !data.chat)) return null;
  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <IconTile variant="soft" aria-hidden="true">
            <BellRingIcon />
          </IconTile>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">
              Напоминания в мессенджере
            </span>
            <span className="text-xs text-muted-foreground">{DESCRIPTION}</span>
          </div>
        </div>
        <Connect messengers={canLink ? data.messengers : []} chat={data.chat} />
      </FramePanel>
    </Frame>
  );
}
