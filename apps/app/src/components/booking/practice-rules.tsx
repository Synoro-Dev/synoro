"use client";

import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { formatCredits } from "@synoro/validators";

import { useTerms } from "./terms";

function Rule({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/**
 * The rules every practice works by, in plain words with an example. They
 * mirror `clientMayCancel` and `booking.cancel`, and can't be changed yet, so
 * there is nothing to save here.
 */
export function PracticeRules() {
  const terms = useTerms();
  return (
    <Frame spacing="default" className="min-w-0 max-w-3xl">
      <FramePanel className="flex flex-col gap-5">
        <FrameHeader className="p-0">
          <FrameTitle>Правила записи</FrameTitle>
          <FrameDescription>
            Одинаковые для всех клиентов. Менять их пока нельзя.
          </FrameDescription>
        </FrameHeader>
        <Rule title="Отмена и перенос">
          <p>
            Клиент сам отменяет или переносит запись не позже чем за
            24&nbsp;часа до начала. При отмене {formatCredits(1, terms)}{" "}
            возвращается на баланс.
          </p>
          <p className="rounded-md bg-muted px-3 py-2 text-foreground dark:bg-muted/50">
            Например, запись на среду в&nbsp;19:00: до вторника 19:00 клиент
            справится сам. Позже отменить или перенести её можете только вы или
            администратор.
          </p>
        </Rule>
        <Rule title="Если до начала меньше 24 часов">
          <p>
            Вы решаете сами: отменить запись и вернуть оплату на баланс или
            отменить без возврата. Если клиент не пришёл, отметьте это в записи:
            оплата не вернётся.
          </p>
        </Rule>
        <Rule title={`Бесплатная запись: «${terms.free}»`}>
          <p>
            Клиент может отменить или перенести её в любой момент до начала.
          </p>
        </Rule>
        <Rule title="Запись с онлайн-оплатой">
          <p>
            Пока клиент платит, время держится за ним 15&nbsp;минут. Если оплата
            не пришла, время снова свободно.
          </p>
        </Rule>
      </FramePanel>
    </Frame>
  );
}
