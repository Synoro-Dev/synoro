import { z } from "zod";

/**
 * A video-call link as a clean `https` URL, or null when it isn't one.
 *
 * People paste `company.ktalk.ru/abc` without the scheme, so a missing one is
 * added. Anything but `https` (`javascript:`, `http:`), a link with a login
 * or password in it, and a host without a dot are refused: the link is shown
 * to clients as a button.
 */
export function normalizeVideoUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

const isHost = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

/** «Толк», «Телемост»… for the known services, else «Видеовстреча». */
export function videoServiceName(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Видеовстреча";
  }
  if (isHost(host, "ktalk.ru")) return "Толк";
  if (
    isHost(host, "telemost.yandex.ru") ||
    isHost(host, "telemost.360.yandex.ru")
  ) {
    return "Телемост";
  }
  if (isHost(host, "meet.google.com")) return "Google Meet";
  if (isHost(host, "zoom.us")) return "Zoom";
  return "Видеовстреча";
}

/** The form input is whatever was typed; empty means no link (null). */
export const videoUrlSchema = z
  .string()
  .trim()
  .max(500, "Ссылка слишком длинная")
  .transform((value, ctx) => {
    if (!value) return null;
    const url = normalizeVideoUrl(value);
    if (!url) {
      ctx.addIssue({
        code: "custom",
        message:
          "Введите ссылку на видеовстречу, например https://company.ktalk.ru/room",
      });
      return z.NEVER;
    }
    return url;
  });
