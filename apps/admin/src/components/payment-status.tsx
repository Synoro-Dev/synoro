import { Badge } from "@synoro/ui";

const LABELS = {
  pending: "Ожидает",
  succeeded: "Оплачен",
  canceled: "Отменён",
} as const;

export function PaymentStatus({
  status,
  refundedAt,
}: {
  status: keyof typeof LABELS;
  refundedAt: Date | null;
}) {
  if (refundedAt) return <Badge variant="destructive">Возврат</Badge>;
  return (
    <Badge
      variant={
        status === "succeeded"
          ? "default"
          : status === "pending"
            ? "secondary"
            : "outline"
      }
    >
      {LABELS[status]}
    </Badge>
  );
}

export const PERIOD_LABELS = { month: "Месяц", year: "Год" } as const;
