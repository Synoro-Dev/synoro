import {
  AppleIcon,
  BrainIcon,
  DumbbellIcon,
  GraduationCapIcon,
  LanguagesIcon,
  MessageCircleIcon,
  ScaleIcon,
  SparklesIcon,
  StethoscopeIcon,
  WalletIcon,
} from "lucide-react";

import { Section } from "./primitives";

const audience = [
  { icon: BrainIcon, label: "Психологи" },
  { icon: SparklesIcon, label: "Коучи" },
  { icon: GraduationCapIcon, label: "Репетиторы" },
  { icon: ScaleIcon, label: "Юристы" },
  { icon: AppleIcon, label: "Нутрициологи" },
  { icon: MessageCircleIcon, label: "Логопеды" },
  { icon: WalletIcon, label: "Финансовые консультанты" },
  { icon: DumbbellIcon, label: "Тренеры" },
  { icon: StethoscopeIcon, label: "Врачи частной практики" },
  { icon: LanguagesIcon, label: "Преподаватели языков" },
];

export function Audience() {
  return (
    <Section containerClassName="flex flex-col items-center gap-6 px-4 py-12 sm:px-10">
      <h2 className="text-muted-foreground text-center text-sm">
        Для всех, кто работает с людьми по записи
      </h2>
      <ul className="flex max-w-4xl flex-wrap justify-center gap-2">
        {audience.map((item) => (
          <li
            key={item.label}
            className="text-foreground/80 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[15px] whitespace-nowrap"
          >
            <item.icon className="text-muted-foreground size-4" />
            {item.label}
          </li>
        ))}
      </ul>
    </Section>
  );
}
