"use client";
import { useEffect } from "react";

export default function SynoroBooking() {
  useEffect(() => {
    function handleMessage(e: any) {
      if (!e.data || e.data.type !== "synoro:height") return;

      document.querySelectorAll("iframe[data-synoro]").forEach((frame: any) => {
        if (frame.contentWindow === e.source) {
          frame.style.height = `${e.data.height}px`;
        }
      });
    }

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return (
    <iframe
      data-synoro
      src="https://synoro.ru/max"
      title="Онлайн-запись"
      style={{
        width: "100%",
        height: "720px",
        border: 0,
      }}
      loading="lazy"
    />
  );
}
