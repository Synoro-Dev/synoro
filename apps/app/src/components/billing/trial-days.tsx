import { cn } from "@synoro/ui";
import { TRIAL_DAYS } from "@synoro/validators";

import { formatDays } from "./plan";

/**
 * The trial as a row of days: the ones still ahead are filled, so the row
 * empties as the trial runs out.
 */
export function TrialDays({
  left,
  endingSoon,
  className,
}: {
  left: number;
  endingSoon: boolean;
  className?: string;
}) {
  const used = TRIAL_DAYS - Math.min(left, TRIAL_DAYS);
  return (
    <div
      role="img"
      aria-label={`Осталось ${formatDays(left)} из ${TRIAL_DAYS}`}
      className={cn("flex gap-0.5", className)}
    >
      {Array.from({ length: TRIAL_DAYS }, (_, day) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: days are positional
          key={day}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            day < used
              ? "bg-foreground/10"
              : endingSoon
                ? "bg-warning"
                : "bg-info",
          )}
        />
      ))}
    </div>
  );
}
