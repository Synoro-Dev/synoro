import { paths } from "@synoro/config";
import { Button } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { PRO_PRICES } from "@synoro/validators";
import { SparklesIcon } from "lucide-react";
import Link from "next/link";

import { formatRub } from "../payment/format";

/** Shown in place of a «Про» feature while the owner is on the free plan. */
export function ProRequired({ feature }: { feature: string }) {
  return (
    <Alert variant="info">
      <SparklesIcon />
      <AlertTitle>{feature} — на тарифе «Про»</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          {formatRub(PRO_PRICES.month.amount)} в месяц или{" "}
          {formatRub(PRO_PRICES.year.amount)} за год. Оплата картой или по СБП.
        </span>
        <Button
          size="sm"
          nativeButton={false}
          render={<Link href={paths.settings.billing} />}
        >
          Подключить «Про»
        </Button>
      </AlertDescription>
    </Alert>
  );
}
