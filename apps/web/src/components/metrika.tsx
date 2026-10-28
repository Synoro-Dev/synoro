"use client";

import { CONSENT_COOKIE } from "@synoro/ui/cookie-consent";
import Script from "next/script";
import { useEffect } from "react";

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

/**
 * Yandex Metrika counter. Yandex Direct optimizes campaigns for its goals:
 * any link with `data-goal="<name>"` reports `reachGoal(<name>)` on click,
 * so create JavaScript-event goals with the same names in Metrika.
 */
export function Metrika({ id }: { id: number }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const goal = target
        ?.closest<HTMLElement>("[data-goal]")
        ?.getAttribute("data-goal");
      if (goal) window.ym?.(id, "reachGoal", goal);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [id]);

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(){if(document.cookie.indexOf("${CONSENT_COOKIE}=declined")!==-1)return;(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${id},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});})();`}
      </Script>
      <noscript>
        <div>
          {/* biome-ignore lint/performance/noImgElement: tracking pixel */}
          <img
            src={`https://mc.yandex.ru/watch/${id}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
