import { cn } from "@synoro/ui";
import { CheckIcon, CodeIcon } from "lucide-react";

import { brand } from "~/lib/brand";

import { Container, SectionHeading } from "./primitives";

const stages = [
  {
    label: "Сразу после регистрации",
    value: `${brand.rootDomain}/anna`,
  },
  { label: "В настройках страницы записи", value: "Код для сайта" },
  {
    label: "На странице вашего сайта",
    value: "anna-ivanova.ru/zapis",
    highlight: true,
  },
];

const code = [
  "<iframe data-synoro",
  `  src="https://${brand.rootDomain}/anna"`,
  '  title="Онлайн-запись"',
  '  style="width:100%;height:640px;border:0"',
  '  loading="lazy"></iframe>',
  "<script>/* подстройка высоты */</script>",
];

function CodePanel() {
  return (
    <div className="w-full min-w-0 rounded-xl border border-white/10 bg-zinc-900/80 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
          <CodeIcon className="size-4 text-zinc-300" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Код для сайта</p>
          <p className="text-xs text-zinc-400">
            Сокращённо. Полный код — в настройках страницы записи
          </p>
        </div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
        {code.join("\n")}
      </pre>
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-zinc-400">
        <CheckIcon className="size-3.5 text-emerald-400" />
        Высота подстраивается под страницу записи
      </div>
    </div>
  );
}

export function Embed() {
  return (
    <section
      id="embed"
      className="relative isolate overflow-hidden border-t border-zinc-800 bg-zinc-950 text-white"
    >
      <div
        aria-hidden
        className="bg-grid absolute inset-0 -z-10 [--grid-color:rgb(255_255_255/0.05)] [mask-image:radial-gradient(ellipse_60%_60%_at_70%_40%,black,transparent)]"
      />
      <Container className="grid items-center gap-14 border-zinc-800 px-4 py-20 sm:px-10 sm:py-28 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <SectionHeading>Запись прямо на вашем сайте</SectionHeading>
          <p className="max-w-lg text-base text-pretty text-zinc-400 sm:text-lg">
            Начните со ссылки Synoro, а когда захотите — добавьте страницу
            записи на свой сайт. Клиент выберет время у вас на сайте, а вход и
            оплата откроются отдельно. Работает на любом тарифе.
          </p>

          <ol className="mt-4 flex flex-col">
            {stages.map((stage, index) => (
              <li
                key={stage.value}
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
                    {stage.value}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <CodePanel />
      </Container>
    </section>
  );
}
