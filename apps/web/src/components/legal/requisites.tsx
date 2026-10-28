import { legal } from "@synoro/config";

const { operator } = legal;

/** The operator's details; fields that are not filled in are left out. */
export function Requisites() {
  const rows: [string, string][] = [
    ["Наименование", operator.fullName],
    ["ИНН", operator.inn],
    ...(operator.ogrnip
      ? [["ОГРНИП", operator.ogrnip] as [string, string]]
      : []),
    ...(operator.address
      ? [["Адрес", operator.address] as [string, string]]
      : []),
    ["Электронная почта", operator.email],
    ["Сайт", legal.siteUrl.replace("https://", "")],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-lg border p-4 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
