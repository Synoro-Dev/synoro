import { cn } from "@synoro/ui";
import { CheckIcon, GlobeIcon, LockIcon } from "lucide-react";

import { brand } from "~/lib/brand";

import { Container } from "./primitives";

const stages = [
  {
    label: "Сразу после регистрации",
    host: `${brand.rootDomain}/p/anna`,
  },
  { label: "Поддомен платформы", host: `anna.${brand.rootDomain}` },
  {
    label: "Ваш собственный домен",
    host: "zapis.anna-ivanova.ru",
    highlight: true,
  },
];

const records = [
  { type: "CNAME", name: "zapis", value: `domains.${brand.rootDomain}` },
  {
    type: "TXT",
    name: "_booking-verification.zapis",
    value: "c2y4-9fq1-kd7a",
  },
];

function DnsPanel() {
  return (
    <div className="w-full min-w-0 rounded-xl border border-white/10 bg-zinc-900/80 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
          <GlobeIcon className="size-4 text-zinc-300" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">
            zapis.anna-ivanova.ru
          </p>
          <p className="text-xs text-zinc-400">Добавлен 2 минуты назад</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          Активен
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-400">
            <tr>
              <th className="px-4 py-2.5 font-normal">Тип</th>
              <th className="px-4 py-2.5 font-normal">Имя</th>
              <th className="px-4 py-2.5 font-normal">Значение</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="font-mono text-zinc-300">
            {records.map((record) => (
              <tr key={record.type} className="border-t border-white/5">
                <td className="px-4 py-3">{record.type}</td>
                <td className="px-4 py-3 whitespace-nowrap">{record.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">{record.value}</td>
                <td className="px-4 py-3">
                  <CheckIcon className="size-3.5 text-emerald-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-zinc-400">
        <CheckIcon className="size-3.5 text-emerald-400" />
        Записи проверены — страница открывается по новому адресу
      </div>
    </div>
  );
}

export function Domain() {
  return (
    <section
      id="domain"
      className="relative isolate overflow-hidden border-t border-zinc-800 bg-zinc-950 text-white"
    >
      <div
        aria-hidden
        className="bg-grid absolute inset-0 -z-10 [--grid-color:rgb(255_255_255/0.05)] [mask-image:radial-gradient(ellipse_60%_60%_at_70%_40%,black,transparent)]"
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-0 -z-10 h-96 w-[36rem] rounded-full bg-violet-600/20 blur-[120px]"
      />
      <Container className="grid items-center gap-14 border-zinc-800 px-4 py-20 sm:px-10 sm:py-28 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 ring-inset">
              <LockIcon className="size-3.5" />
            </span>
            Свой домен
          </div>
          <h2 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl md:text-5xl">
            Страница записи на вашем адресе
          </h2>
          <p className="max-w-lg text-base text-pretty text-zinc-400 sm:text-lg">
            Начните со ссылки на платформе, а когда будете готовы — подключите
            свой домен. Добавьте две DNS-записи, остальное мы проверим сами.
          </p>

          <ol className="mt-4 flex flex-col">
            {stages.map((stage, index) => (
              <li
                key={stage.host}
                className="relative flex gap-4 pb-6 last:pb-0"
              >
                {index < stages.length - 1 && (
                  <span className="absolute top-7 bottom-1 left-[11px] w-px bg-zinc-800" />
                )}
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ring-1",
                    stage.highlight
                      ? "bg-white text-zinc-950 ring-white"
                      : "bg-zinc-900 text-zinc-400 ring-zinc-700",
                  )}
                >
                  {index + 1}
                </span>
                <div>
                  <p className="text-xs text-zinc-400">{stage.label}</p>
                  <p
                    className={cn(
                      "mt-0.5 font-mono text-sm",
                      stage.highlight ? "text-white" : "text-zinc-300",
                    )}
                  >
                    {stage.host}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <DnsPanel />
      </Container>
    </section>
  );
}
