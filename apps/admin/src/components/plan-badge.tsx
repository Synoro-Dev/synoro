import { Badge } from "@synoro/ui";

type Plan = "none" | "trial" | "active" | "expired";

const LABELS: Record<Plan, string> = {
  none: "Без практики",
  trial: "Пробный",
  active: "Про",
  expired: "Бесплатный",
};

export function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <Badge
      variant={
        plan === "active"
          ? "default"
          : plan === "trial"
            ? "secondary"
            : "outline"
      }
    >
      {LABELS[plan]}
    </Badge>
  );
}
