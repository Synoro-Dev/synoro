import { CONSENT_COOKIE } from "@synoro/ui/cookie-consent";
import Script from "next/script";

/** Exported for the cookie banner, which stops this counter on refusal. */
export const COUNTER_ID = 109190662;

/** Яндекс Метрика. Только в production, чтобы не засорять статистику. */
export function YandexMetrika() {
  if (process.env.NODE_ENV !== "production") return null;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`
(function(){
if (document.cookie.indexOf("${CONSENT_COOKIE}=declined") !== -1) { return; }
(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}', 'ym');

ym(${COUNTER_ID}, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
})();
`}
      </Script>
      <noscript>
        <div>
          {/* biome-ignore lint/performance/noImgElement: tracking pixel */}
          <img
            src={`https://mc.yandex.ru/watch/${COUNTER_ID}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
