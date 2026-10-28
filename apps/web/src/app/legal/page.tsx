import { legal } from "@synoro/config";
import type { Metadata } from "next";

import { LegalPage, Part } from "~/components/legal/document";
import { Requisites } from "~/components/legal/requisites";

export const metadata: Metadata = {
  title: "Документы",
  description: "Оферта, политика конфиденциальности и другие документы Synoro.",
  alternates: { canonical: "/legal" },
};

export default function LegalIndexPage() {
  return (
    <LegalPage title="Документы" updatedAt={legal.updatedAt}>
      <Part id="docs" n={1} title="Правила сервиса">
        <ul className="divide-y rounded-lg border">
          {Object.values(legal.docs).map((doc) => (
            <li key={doc.path}>
              <a
                href={doc.path}
                className="hover:bg-muted/50 block px-4 py-3 transition-colors"
              >
                <span className="block font-medium">{doc.title}</span>
                <span className="text-muted-foreground block text-sm">
                  {doc.description}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Part>
      <Part id="requisites" n={2} title="Реквизиты">
        <Requisites />
      </Part>
    </LegalPage>
  );
}
