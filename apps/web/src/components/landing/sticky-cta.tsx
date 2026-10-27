"use client";

import { buttonVariants, cn } from "@synoro/ui";
import { useEffect, useState } from "react";

import {
  featuredPlan,
  perMonth,
  planSignupUrl,
  rubles,
  signupGoal,
} from "~/lib/pricing";

/**
 * Mobile-only bottom bar with the yearly offer, so ad visitors can buy from
 * anywhere on the page. Hidden while a section with its own CTAs (the hero,
 * the pricing table) is on screen.
 */
export function StickyCta({ signupUrl }: { signupUrl: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sections = ["top", "pricing"]
      .map((id) => document.getElementById(id))
      .filter((element) => element !== null);
    const onScreen = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      }
      setVisible(onScreen.size === 0);
    });
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "bg-background/90 fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur-xl transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <p className="font-medium">
            «{featuredPlan.name}» — {rubles(featuredPlan.yearly)} за год
          </p>
          <p className="text-muted-foreground">
            {rubles(perMonth(featuredPlan.yearly))} в месяц
          </p>
        </div>
        <a
          href={planSignupUrl(signupUrl, featuredPlan.id, "year")}
          data-goal={signupGoal(featuredPlan.id, "year")}
          className={cn(buttonVariants({ size: "lg" }), "rounded-full px-5")}
        >
          Подключить
        </a>
      </div>
    </div>
  );
}
