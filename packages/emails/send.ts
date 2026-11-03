import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { render } from "@react-email/components";
import { logger } from "@synoro/config";
import nodemailer from "nodemailer";
import type { ReactNode } from "react";
import { Resend } from "resend";

import { env } from "./env";
import { type Provider, sendWithFallback } from "./fallback";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// A half-configured Postbox fails every send instead of being left out: with
// no Resend behind it the mail would otherwise be dropped without a retry.
// Its default EMAIL_FROM (Resend's onboarding address) is never verified in
// Postbox, which rejects such a sender.
const postboxProblem =
  !env.POSTBOX_ACCESS_KEY_ID && !env.POSTBOX_SECRET_ACCESS_KEY
    ? null
    : !env.POSTBOX_ACCESS_KEY_ID || !env.POSTBOX_SECRET_ACCESS_KEY
      ? "set both POSTBOX_ACCESS_KEY_ID and POSTBOX_SECRET_ACCESS_KEY"
      : env.EMAIL_FROM.includes("@resend.dev")
        ? "set EMAIL_FROM to an address verified in Postbox"
        : null;

// Yandex Cloud Postbox through its SES v2-compatible HTTP API: a static
// access key of a service account with the `postbox.sender` role. One
// attempt with short timeouts — at most ~15 s of the `send-email` task's
// 60 s, leaving Resend time to send; retries are the task's job.
const postbox =
  env.POSTBOX_ACCESS_KEY_ID && env.POSTBOX_SECRET_ACCESS_KEY && !postboxProblem
    ? new SESv2Client({
        endpoint: env.POSTBOX_ENDPOINT,
        region: "ru-central1",
        credentials: {
          accessKeyId: env.POSTBOX_ACCESS_KEY_ID,
          secretAccessKey: env.POSTBOX_SECRET_ACCESS_KEY,
        },
        maxAttempts: 1,
        requestHandler: {
          connectionTimeout: 5_000,
          requestTimeout: 10_000,
          // Without it a stalled request only logs a warning and never fails
          // over to Resend.
          throwOnRequestTimeout: true,
        },
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

const providers: Provider<Required<EmailHtml>>[] = [];
if (postboxProblem) {
  providers.push({
    name: "postbox",
    send: () => Promise.reject(new Error(`postbox: ${postboxProblem}`)),
  });
}
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

/** Postbox first, Resend if it fails (see `sendWithFallback`). */
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
  await sendWithFallback(providers, message, (provider, fallback, error) =>
    logger.warn("email.provider_failed", {
      provider,
      fallback,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export const sendEmail = async (email: Emails) => {
  const { react, ...rest } = email;
  await deliver({ ...rest, html: await render(react) });
};

export const sendEmailHtml = (email: EmailHtml) => deliver(email);
