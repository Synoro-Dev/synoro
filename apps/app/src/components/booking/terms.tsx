"use client";

import {
  type Profession,
  type ProfessionTerms,
  professionTerms,
} from "@synoro/validators";
import { createContext, type ReactNode, use } from "react";

const TermsContext = createContext<ProfessionTerms>(professionTerms("other"));

/**
 * The words of one practice's profession («консультация», «занятие») for
 * the staff console below it. Pages that list several practices call
 * `professionTerms(row.profession)` per row instead.
 */
export function TermsProvider({
  profession,
  children,
}: {
  profession: Profession;
  children: ReactNode;
}) {
  return (
    <TermsContext value={professionTerms(profession)}>{children}</TermsContext>
  );
}

export function useTerms() {
  return use(TermsContext);
}
