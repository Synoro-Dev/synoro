"use client";

import { paths } from "@synoro/config";
import {
  Button,
  cn,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@synoro/ui";
import { useQuery } from "@tanstack/react-query";
import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { orpc } from "~/orpc/react";
import {
  daysLeft,
  ENDING_SOON_DAYS,
  formatDate,
  formatDays,
  planName,
} from "../billing/plan";
import { TrialDays } from "../billing/trial-days";
import { usePlanClock } from "../billing/use-plan-clock";

/**
 * The owner's plan, always in sight: the trial counting down, the paid
 * period, or the free plan — with the way to pay for «Про» one click away.
 */
export function NavPlan() {
  const pathname = usePathname();
  const billing = useQuery(orpc.billing.get.queryOptions());
  const plan = billing.data?.plan;
  const until = !plan?.pro
    ? null
    : plan.status === "trial"
      ? plan.trialEndsAt
      : plan.activeUntil;
  usePlanClock(until);
  if (!billing.data || !plan) return null;

  const { autorenew } = billing.data;
  const onBilling = pathname === paths.settings.billing;
  const left = until ? daysLeft(until) : 0;
  const endingSoon = plan.pro && !autorenew && left <= ENDING_SOON_DAYS;
  const name = planName(plan);

  // Paid and not running out: a quiet line, nothing to sell.
  if (plan.status === "active" && !endingSoon) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip={`Тариф «Про» до ${until && formatDate(until)}`}
            isActive={onBilling}
            render={<Link href={paths.settings.billing} />}
          >
            <SparklesIcon />
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Тариф «Про»</span>
              <span className="truncate text-xs text-muted-foreground">
                {autorenew ? "Продлится" : "До"} {until && formatDate(until)}
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const status = plan.pro
    ? `Осталось ${formatDays(left)}`
    : plan.status === "expired"
      ? "Онлайн-оплата, домен и анкета выключены"
      : "Онлайн-оплата, домен и анкета — на «Про»";
  const action =
    plan.status === "active"
      ? "Продлить «Про»"
      : plan.status === "expired"
        ? "Вернуть «Про»"
        : "Оплатить «Про»";

  return (
    <SidebarMenu>
      {/* Collapsed sidebar: just the icon, the rest in the tooltip. */}
      <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
        <SidebarMenuButton
          tooltip={`Тариф: ${name}. ${status}`}
          isActive={onBilling}
          render={<Link href={paths.settings.billing} />}
          // On the button: its own `[&>svg]:` grey outranks an icon class.
          className={cn(
            endingSoon || plan.status === "expired"
              ? "[&>svg]:text-warning"
              : plan.pro && "[&>svg]:text-info",
          )}
        >
          <SparklesIcon />
          <span>{name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
        <div className="flex flex-col gap-2.5 rounded-lg border bg-background p-3 text-sm shadow-xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Ваш тариф</span>
            <span className="font-medium">{name}</span>
          </div>
          {plan.status === "trial" && (
            <TrialDays left={left} endingSoon={endingSoon} />
          )}
          <span
            className={cn(
              "text-xs",
              endingSoon
                ? "text-warning-foreground dark:text-warning"
                : "text-muted-foreground",
            )}
          >
            {status}
            {plan.pro && until && `, до ${formatDate(until)}`}
          </span>
          {!onBilling && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={paths.settings.billing} />}
            >
              {action}
            </Button>
          )}
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
