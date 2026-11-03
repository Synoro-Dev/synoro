import type { ProfessionPage } from "~/lib/professions";

import { Section, SectionHeading } from "./primitives";

/** Three things a profession cares about, under the hero of its page. */
export function ProfessionPoints({ page }: { page: ProfessionPage }) {
  return (
    <Section>
      <div className="px-4 pt-16 pb-10 sm:px-10 sm:pt-20">
        <SectionHeading>{page.pointsHeading}</SectionHeading>
      </div>
      <ul className="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {page.points.map((point) => (
          <li key={point.title} className="flex flex-col gap-2 p-6 sm:p-8">
            <p className="font-medium">{point.title}</p>
            <p className="text-muted-foreground text-sm">{point.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
