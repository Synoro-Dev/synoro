"use client";

import { useEffect } from "react";

/**
 * Lets `[data-reveal]` blocks fade in as they scroll into view (styles in
 * `styles.css`). Only blocks still below the fold are hidden, and only once
 * the script runs: the page reads the same without it, for crawlers, and
 * under reduced motion.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );

    const blocks = document.querySelectorAll<HTMLElement>("[data-reveal]");
    for (const block of blocks) {
      if (block.getBoundingClientRect().top < window.innerHeight) continue;
      block.dataset.reveal = "hidden";
      observer.observe(block);
    }

    return () => {
      observer.disconnect();
      for (const block of blocks) block.dataset.reveal = "";
    };
  }, []);

  return null;
}
