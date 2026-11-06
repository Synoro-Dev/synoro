import { paths } from "@synoro/config";
import {
  ClipboardListIcon,
  Clock3Icon,
  CreditCardIcon,
  ListChecksIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  PanelTopIcon,
  ScrollTextIcon,
  ShieldIcon,
  SparklesIcon,
} from "lucide-react";

interface PracticeSection {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

/**
 * The practice's settings, grouped. One list for the sidebar's search, the
 * settings page and the rail beside each section. Administrators see only
 * what they may do — never a page that would just say «the owner sets this».
 */
export function practiceSections(
  practiceId: string,
  isOwner: boolean,
): { title: string; sections: PracticeSection[] }[] {
  const groups: {
    title: string;
    sections: (PracticeSection & { ownerOnly?: boolean })[];
  }[] = [
    {
      title: "Запись",
      sections: [
        {
          title: "Страница записи",
          description: "Фото, оформление и ссылка: как вас видят клиенты",
          href: paths.booking.page(practiceId),
          icon: PanelTopIcon,
        },
        {
          title: "Услуги",
          description: "Что можно забронировать: длительность и цена",
          href: paths.booking.services(practiceId),
          icon: ClipboardListIcon,
          ownerOnly: true,
        },
        {
          title: "Рабочие часы",
          description: "Когда к вам можно записаться и какие даты закрыты",
          href: paths.booking.schedule(practiceId),
          icon: Clock3Icon,
        },
        {
          title: "Правила",
          description: "Когда клиент может сам отменить запись",
          href: paths.booking.rules(practiceId),
          icon: ScrollTextIcon,
        },
        {
          title: "Анкета",
          description: "Что спросить у клиента при записи",
          href: paths.booking.questions(practiceId),
          icon: ListChecksIcon,
          ownerOnly: true,
        },
      ],
    },
    {
      title: "Клиенты и оплата",
      sections: [
        {
          title: "Сообщения клиентам",
          description: "Напоминания и письма, которые уходят сами",
          href: paths.booking.messages(practiceId),
          icon: MessageSquareTextIcon,
          ownerOnly: true,
        },
        {
          title: "Онлайн-оплата",
          description: "Куда клиенты платят и сколько это стоит",
          href: paths.booking.onlinePayment(practiceId),
          icon: CreditCardIcon,
          ownerOnly: true,
        },
      ],
    },
    {
      title: "Практика",
      sections: [
        {
          title: "Команда",
          description: "Кто ещё ведёт записи в вашей практике",
          href: paths.booking.team(practiceId),
          icon: ShieldIcon,
        },
        {
          title: "Тариф",
          description: "Что входит в «Про» и до какого числа оплачено",
          href: paths.booking.plan(practiceId),
          icon: SparklesIcon,
          ownerOnly: true,
        },
      ],
    },
  ];

  return groups
    .map(({ title, sections }) => ({
      title,
      sections: sections
        .filter((section) => isOwner || !section.ownerOnly)
        .map(({ ownerOnly: _, ...section }) => section),
    }))
    .filter((group) => group.sections.length > 0);
}

/**
 * Pages inside the practice's settings: on them the main sidebar lists the
 * sections. Every role's list: a page the role can't open redirects anyway.
 */
export function isPracticeSettingsPage(practiceId: string, pathname: string) {
  return (
    pathname === paths.booking.settings(practiceId) ||
    pathname === paths.booking.domain(practiceId) ||
    practiceSections(practiceId, true).some((group) =>
      group.sections.some((section) => section.href === pathname),
    )
  );
}
