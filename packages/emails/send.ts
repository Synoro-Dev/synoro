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
const postboxHalfConfigured =
  !env.POSTBOX_ACCESS_KEY_ID !== !env.POSTBOX_SECRET_ACCESS_KEY;

// Yandex Cloud Postbox through its SES v2-compatible HTTP API: a static
// access key of a service account with the `postbox.sender` role. One
// attempt, aborted after 15 s of the `send-email` task's 60 s, leaving
// Resend time to send; retries are the task's job.
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
  /** Plain-text twin of `html`: a mail with only HTML scores worse on spam filters. */
  text?: string;
  subject: string;
  to: string[];
  from?: string;
};

type Message = EmailHtml & { from: string };

const providers: Provider<Message>[] = [];
if (postboxHalfConfigured) {
  providers.push({
    name: "postbox",
    send: () =>
      Promise.reject(
        new Error(
          "postbox: set both POSTBOX_ACCESS_KEY_ID and POSTBOX_SECRET_ACCESS_KEY",
        ),
      ),
  });
}
if (postbox) {
  providers.push({
    name: "postbox",
    send: async (email) => {
      // Postbox rejects senders it hasn't verified; Resend's onboarding
      // address (the default EMAIL_FROM) never is.
      if (email.from.includes("@resend.dev")) {
        throw new Error("postbox: send from an address verified in Postbox");
      }
      // The signal covers the whole call, the response body included;
      // requestTimeout only waits for the headers.
      await postbox.send(
        new SendEmailCommand({
          FromEmailAddress: email.from,
          Destination: { ToAddresses: email.to },
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: email.html, Charset: "UTF-8" },
                ...(email.text && {
                  Text: { Data: email.text, Charset: "UTF-8" },
                }),
              },
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(15_000) },
      );
    },
  });
}
if (resend) {
  providers.push({
    name: "resend",
    send: async (email) => {
      // With Postbox's ~15 s, inside the `send-email` task's 60 s.
      const { error } = await resend.emails.send(
        {
          from: email.from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          ...(email.text && { text: email.text }),
        },
        { signal: AbortSignal.timeout(40_000) },
      );
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
  const [html, text] = await Promise.all([
    render(react),
    render(react, { plainText: true }),
  ]);
  await deliver({ ...rest, html, text });
};

export const sendEmailHtml = (email: EmailHtml) => deliver(email);
