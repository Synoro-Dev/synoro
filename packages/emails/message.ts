import { render, toPlainText } from "@react-email/components";
import type { ReactNode } from "react";

/**
 * HTML and its plain-text twin from one render: the text comes from the HTML
 * already produced, so the React tree (and Tailwind) is rendered once.
 */
export async function renderParts(react: ReactNode) {
  const html = await render(react);
  return { html, text: toPlainText(html) };
}

/** Postbox's `Content.Simple.Body`; `Text` only when the mail has a text part. */
export function postboxBody({ html, text }: { html: string; text?: string }) {
  return {
    Html: { Data: html, Charset: "UTF-8" },
    ...(text && { Text: { Data: text, Charset: "UTF-8" } }),
  };
}

/** Resend's `emails.send` payload; `text` only when the mail has one. */
export function resendPayload({
  from,
  to,
  subject,
  html,
  text,
}: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
}) {
  return { from, to, subject, html, ...(text && { text }) };
}
