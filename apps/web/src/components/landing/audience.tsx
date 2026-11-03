import { cn } from "@synoro/ui";
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

import { professionPages, professionPath } from "~/lib/professions";

import { Section } from "./primitives";

/** `page` — the profession page (`/dlya/<slug>`) the chip leads to. */
const audience = [
  { icon: BrainIcon, label: "Психологи", page: "psihologov" },
  { icon: SparklesIcon, label: "Коучи", page: "kouchey" },
  { icon: GraduationCapIcon, label: "Репетиторы", page: "repetitorov" },
  { icon: ScaleIcon, label: "Юристы", page: "yuristov" },
  { icon: AppleIcon, label: "Нутрициологи", page: "vrachey" },
  { icon: MessageCircleIcon, label: "Логопеды", page: "vrachey" },
  { icon: WalletIcon, label: "Финансовые консультанты", page: "yuristov" },
  { icon: DumbbellIcon, label: "Тренеры", page: "trenerov" },
  { icon: StethoscopeIcon, label: "Врачи частной практики", page: "vrachey" },
  { icon: LanguagesIcon, label: "Преподаватели языков", page: "repetitorov" },
];

const chip =
  "text-foreground/80 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[15px] whitespace-nowrap";

export function Audience() {
  return (
    <Section containerClassName="flex flex-col items-center gap-6 px-4 py-12 sm:px-10">
      <h2 className="text-muted-foreground text-center text-sm">
        Для всех, кто работает с людьми по записи
      </h2>
      <ul className="flex max-w-4xl flex-wrap justify-center gap-2">
        {audience.map((item) => {
          const page = professionPages.find(({ slug }) => slug === item.page);
          return (
            <li key={item.label}>
              {page ? (
                <a
                  href={professionPath(page)}
                  className={cn(chip, "hover:bg-muted transition-colors")}
                >
                  <item.icon className="text-muted-foreground size-4" />
                  {item.label}
                </a>
              ) : (
                <span className={chip}>
                  <item.icon className="text-muted-foreground size-4" />
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
