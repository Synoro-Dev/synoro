import { legal } from "@synoro/config";
import {
  FileCheckIcon,
  LandmarkIcon,
  LockKeyholeIcon,
  ServerIcon,
} from "lucide-react";

import { IconTile, Lead, Section, SectionHeading } from "./primitives";

/** Only what the legal documents and the product already promise. */
const guarantees = [
  {
    icon: ServerIcon,
    title: "Данные хранятся в России",
    text: "Базы с персональными данными граждан РФ размещены на серверах в России.",
    href: `${legal.docs.privacy.path}#location`,
    link: "Где хранятся данные",
  },
  {
    icon: FileCheckIcon,
    title: "Работаем по 152-ФЗ",
    text: "Политика и согласие составлены по закону о персональных данных. Клиент может отозвать согласие в любой момент.",
    href: legal.docs.consent.path,
    link: "Текст согласия",
  },
  {
    icon: LandmarkIcon,
    title: "Деньги идут сразу к вам",
    text: "Клиент платит на ваш счёт в ЮKassa или Т-Банке. Мы не берём процент и не держим ваши деньги.",
    href: "#pricing",
    link: "Тарифы",
  },
  {
    icon: LockKeyholeIcon,
    title: "Клиенту не нужен пароль",
    text: "Клиент входит по коду из письма, а ключи платёжного сервиса мы храним в зашифрованном виде.",
    href: legal.docs.privacy.path,
    link: "Политика конфиденциальности",
  },
];

export function Trust() {
  return (
    <Section id="trust">
      <div className="flex flex-col gap-5 px-4 pt-16 pb-12 sm:px-10 sm:pt-24">
        <SectionHeading>Обещания, которые можно проверить</SectionHeading>
        <Lead>
          В расписании и оплатах — ваши клиенты и ваши деньги. Поэтому важное мы
          записали в открытых документах, а не только в обещаниях.
        </Lead>
      </div>

      <ul className="grid border-t sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        {guarantees.map((item) => (
          <li
            key={item.title}
            className="flex flex-col gap-3 border-b p-6 last:border-b-0 sm:p-8 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-r lg:border-b-0 lg:last:border-r-0"
          >
            <IconTile icon={item.icon} className="size-8" />
            <p className="mt-2 font-medium">{item.title}</p>
            <p className="text-muted-foreground text-sm text-pretty">
              {item.text}
            </p>
            <a
              href={item.href}
              className="text-muted-foreground hover:text-foreground mt-auto w-fit text-sm underline underline-offset-4 transition-colors"
            >
              {item.link}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
