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
    <Section containerClassName="py-12">
      <p className="text-muted-foreground px-4 text-center text-sm">
        Для всех, кто работает с людьми по записи
      </p>
      <div className="mt-8 flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        {/* Two copies so the -50% translate loops seamlessly. */}
        <div className="animate-marquee flex shrink-0 gap-10 pr-10 hover:[animation-play-state:paused]">
          {[...audience, ...audience].map((item, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: duplicated list
              key={index}
              aria-hidden={index >= audience.length}
              className="flex items-center gap-2 text-lg font-medium whitespace-nowrap text-zinc-400"
            >
              <item.icon className="size-5" />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}
