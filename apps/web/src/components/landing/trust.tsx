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
    text: "Базы с персональными данными граждан РФ размещены на серверах на территории России.",
    href: `${legal.docs.privacy.path}#location`,
    link: "Где хранятся данные",
  },
  {
    icon: FileCheckIcon,
    title: "По закону о персональных данных",
    text: "Политика и согласие составлены по 152-ФЗ. Клиент в любой момент может отозвать согласие.",
    href: legal.docs.consent.path,
    link: "Текст согласия",
  },
  {
    icon: LandmarkIcon,
    title: "Деньги не проходят через нас",
    text: "Оплаты клиентов идут напрямую на ваш счёт в ЮKassa. Мы не удерживаем процент и не держим ваши деньги.",
    href: "#pricing",
    link: "Тарифы",
  },
  {
    icon: LockKeyholeIcon,
    title: "Ключи и ссылки под защитой",
    text: "Ключи платёжного сервиса хранятся в зашифрованном виде, а ссылки на записи — в виде необратимых хэшей.",
    href: legal.docs.privacy.path,
    link: "Политика конфиденциальности",
  },
];

export function Trust() {
  return (
    <Section id="trust">
      <div className="flex flex-col gap-5 px-4 pt-16 pb-12 sm:px-10 sm:pt-24">
        <SectionHeading>Надёжно, потому что по правилам</SectionHeading>
        <Lead>
          В расписании и оплатах — ваши клиенты и деньги. Поэтому всё важное
          записано в открытых документах, а не только в обещаниях.
        </Lead>
      </div>

      <ul className="grid border-t sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        {guarantees.map((item) => (
          <li
            key={item.title}
            className="flex flex-col gap-3 border-b p-6 last:border-b-0 sm:p-8 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-r lg:last:border-r-0"
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
