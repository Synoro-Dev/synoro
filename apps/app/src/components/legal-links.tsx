import { type LegalDocKey, legal, legalUrl } from "@synoro/config";
import { cn } from "@synoro/ui";
import type { ReactNode } from "react";

/** A link to a legal document; opens aside, so a half-filled form stays put. */
function LegalLink({
  doc,
  children,
}: {
  doc: LegalDocKey;
  children?: ReactNode;
}) {
  return (
    <a
      href={legalUrl(doc)}
      target="_blank"
      rel="noopener"
      className="underline underline-offset-2 transition-colors hover:text-foreground"
    >
      {children ?? legal.docs[doc].short}
    </a>
  );
}

/** What a visitor agrees to by signing up. */
export function SignupLegalNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-balance text-center text-xs text-muted-foreground",
        className,
      )}
    >
      Создавая аккаунт, вы принимаете{" "}
      <LegalLink doc="terms">пользовательское соглашение</LegalLink> и даёте{" "}
      <LegalLink doc="consent">
        согласие на обработку персональных данных
      </LegalLink>
      . Подробнее — в{" "}
      <LegalLink doc="privacy">политике конфиденциальности</LegalLink>.
    </p>
  );
}

/** What a client agrees to by paying for a booking. */
export function BookingLegalNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Нажимая «Оплатить», вы принимаете{" "}
      <LegalLink doc="bookingTerms">условия для клиентов</LegalLink> и даёте{" "}
      <LegalLink doc="consent">
        согласие на обработку персональных данных
      </LegalLink>
      ; подробнее —{" "}
      <LegalLink doc="privacy">политика конфиденциальности</LegalLink>.
    </p>
  );
}

/** Compact footer of the public pages. */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <LegalLink doc="bookingTerms" />
      <LegalLink doc="privacy" />
      <LegalLink doc="cookies" />
      <span>
        {legal.operator.name}, ИНН {legal.operator.inn}
      </span>
    </footer>
  );
}
