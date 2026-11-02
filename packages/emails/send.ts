import { render } from "@react-email/components";
import { logger } from "@synoro/config";
import nodemailer from "nodemailer";
import type { ReactNode } from "react";
import { Resend } from "resend";

import { env } from "./env";

export const resend = env.RESEND_API_KEY
  ? new Resend(env.RESEND_API_KEY)
  : null;

// Yandex Cloud Postbox over SMTP: an API key of a service account with the
// `postbox.sender` role, scope `yc.postbox.send` (login = key id, password =
// secret). Short timeouts so an unreachable Postbox falls back to Resend
// within the `send-email` task instead of hanging on nodemailer's defaults.
const postbox =
  env.POSTBOX_API_KEY_ID && env.POSTBOX_API_KEY
    ? nodemailer.createTransport({
        host: env.POSTBOX_SMTP_HOST,
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: env.POSTBOX_API_KEY_ID, pass: env.POSTBOX_API_KEY },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      })
    : null;

export interface Emails {
  react: ReactNode;
  subject: string;
  to: string[];
  from?: string;
}

export type EmailHtml = {
  html: string;
  subject: string;
  to: string[];
  from?: string;
};

type Provider = {
  name: string;
  send: (email: Required<EmailHtml>) => Promise<unknown>;
};

const providers: Provider[] = [];
if (postbox) {
  providers.push({ name: "postbox", send: (email) => postbox.sendMail(email) });
}
if (resend) {
  providers.push({
    name: "resend",
    send: async (email) => {
      const { error } = await resend.emails.send(email);
      // Resend reports a refusal in `error` instead of throwing.
      if (error) throw new Error(`${error.name}: ${error.message}`);
    },
  });
}

/**
 * Postbox first, Resend if it fails. Throws when every configured provider
 * failed, so `send-email` fails and retries.
 */
async function deliver(email: EmailHtml) {
  const message = { ...email, from: email.from ?? env.EMAIL_FROM };
  if (env.EMAIL_SANDBOX_ENABLED) {
    const transporter = nodemailer.createTransport({
      host: env.EMAIL_SANDBOX_HOST,
      secure: false,
      port: 2500,
    });
    await transporter.sendMail(message);
    return;
  }
  if (providers.length === 0) {
    logger.warn("email.not_configured", {
      hint: "Add POSTBOX_API_KEY_ID + POSTBOX_API_KEY or RESEND_API_KEY to .env",
    });
    return;
  }
  let lastError: unknown;
  for (const [i, provider] of providers.entries()) {
    try {
      await provider.send(message);
      return;
    } catch (error) {
      lastError = error;
      const next = providers[i + 1];
      logger.warn("email.provider_failed", {
        provider: provider.name,
        fallback: next?.name ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError;
}

export const sendEmail = async (email: Emails) => {
  const { react, ...rest } = email;
  await deliver({ ...rest, html: await render(react) });
};

export const sendEmailHtml = (email: EmailHtml) => deliver(email);
