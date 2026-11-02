import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { render } from "@react-email/components";
import { logger } from "@synoro/config";
import nodemailer from "nodemailer";
import type { ReactNode } from "react";
import { Resend } from "resend";

import { env } from "./env";

export const resend = env.RESEND_API_KEY
  ? new Resend(env.RESEND_API_KEY)
  : null;

// Yandex Cloud Postbox through its SES v2-compatible HTTP API: a static
// access key of a service account with the `postbox.sender` role. One
// attempt with a short timeout, so a failing Postbox falls back to Resend at
// once; retries are the `send-email` task's job.
const postbox =
  env.POSTBOX_ACCESS_KEY_ID && env.POSTBOX_SECRET_ACCESS_KEY
    ? new SESv2Client({
        endpoint: env.POSTBOX_ENDPOINT,
        region: "ru-central1",
        credentials: {
          accessKeyId: env.POSTBOX_ACCESS_KEY_ID,
          secretAccessKey: env.POSTBOX_SECRET_ACCESS_KEY,
        },
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
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
  providers.push({
    name: "postbox",
    send: (email) =>
      postbox.send(
        new SendEmailCommand({
          FromEmailAddress: email.from,
          Destination: { ToAddresses: email.to },
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: { Html: { Data: email.html, Charset: "UTF-8" } },
            },
          },
        }),
      ),
  });
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
      hint: "Add the POSTBOX_* access key or RESEND_API_KEY to .env",
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
