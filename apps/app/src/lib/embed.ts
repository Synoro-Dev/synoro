const HEIGHT_MESSAGE = "synoro:height";

/**
 * What a specialist pastes into their site. The script makes the frame as tall
 * as the page; where a site builder strips scripts, the frame stays at 720px
 * and scrolls inside. Only the frame itself may set its height.
 */
export function embedCode(url: string) {
  const listener = `addEventListener("message",function(e){if(!e.data||e.data.type!=="${HEIGHT_MESSAGE}")return;document.querySelectorAll("iframe[data-synoro]").forEach(function(f){if(f.contentWindow===e.source)f.style.height=e.data.height+"px"})})`;
  return `<iframe data-synoro src="${url}" title="Онлайн-запись" style="width:100%;height:720px;border:0" loading="lazy"></iframe>\n<script>${listener}</script>`;
}

/**
 * A ref callback for the booking page: inside a frame, tells the embedding site
 * how tall the page is, now and whenever it changes. `data-framed` drops the
 * page's `min-h-svh`, or it could never report less than the frame's height.
 * Only the height is sent, so any origin may read it.
 */
export function reportFrameHeight(page: HTMLElement) {
  if (window.parent === window) return;
  const root = document.documentElement;
  root.dataset.framed = "";
  const observer = new ResizeObserver(() => {
    window.parent.postMessage(
      {
        type: HEIGHT_MESSAGE,
        height: Math.ceil(page.getBoundingClientRect().height),
      },
      "*",
    );
  });
  observer.observe(page);
  return () => {
    observer.disconnect();
    delete root.dataset.framed;
  };
}
