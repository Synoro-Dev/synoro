import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createElement } from "react";

// Only the providers' network edge is faked; `send.ts` itself runs as is.
type PostboxInput = {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  Content: {
    Simple: {
      Subject: { Data: string };
      Body: { Html: { Data: string }; Text?: { Data: string } };
    };
  };
};

const postboxSent: PostboxInput[] = [];
const resendSent: Record<string, unknown>[] = [];
let postboxDown = false;

mock.module("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    async send(command: { input: PostboxInput }) {
      if (postboxDown) throw new Error("postbox is down");
      postboxSent.push(command.input);
    }
  },
  SendEmailCommand: class {
    constructor(public input: PostboxInput) {}
  },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        resendSent.push(payload);
        return { error: null };
      },
    };
  },
}));

mock.module("./env", () => ({
  env: {
    POSTBOX_ACCESS_KEY_ID: "key",
    POSTBOX_SECRET_ACCESS_KEY: "secret",
    POSTBOX_ENDPOINT: "https://postbox.test",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Synoro <info@synoro.ru>",
    EMAIL_SANDBOX_ENABLED: false,
    EMAIL_SANDBOX_HOST: "localhost",
  },
}));

const { sendEmail, sendEmailHtml } = await import("./send");

const react = createElement("p", null, "Ваш код 123456");
const base = { subject: "Код для входа в Synoro", to: ["anna@example.com"] };

beforeEach(() => {
  postboxSent.length = 0;
  resendSent.length = 0;
  postboxDown = false;
});

describe("sendEmail", () => {
  it("sends the HTML and the text part through Postbox", async () => {
    await sendEmail({ ...base, react });

    const [sent] = postboxSent;
    expect(postboxSent).toHaveLength(1);
    expect(sent?.FromEmailAddress).toBe("Synoro <info@synoro.ru>");
    expect(sent?.Destination.ToAddresses).toEqual(base.to);
    expect(sent?.Content.Simple.Subject.Data).toBe(base.subject);
    expect(sent?.Content.Simple.Body.Html.Data).toContain("123456");
    expect(sent?.Content.Simple.Body.Text?.Data).toContain("123456");
    expect(sent?.Content.Simple.Body.Text?.Data).not.toContain("<");
    expect(resendSent).toHaveLength(0);
  });

  it("falls back to Resend with the text part when Postbox fails", async () => {
    postboxDown = true;
    await sendEmail({ ...base, react });

    const [sent] = resendSent;
    expect(postboxSent).toHaveLength(0);
    expect(resendSent).toHaveLength(1);
    expect(sent?.from).toBe("Synoro <info@synoro.ru>");
    expect(sent?.html).toContain("123456");
    expect(String(sent?.text)).toContain("123456");
  });
});

describe("sendEmailHtml", () => {
  const html = "<p>Ваш код 123456</p>";

  it("sends HTML only through Postbox when there is no text", async () => {
    await sendEmailHtml({ ...base, html });

    const [sent] = postboxSent;
    expect(sent?.Content.Simple.Body.Html.Data).toBe(html);
    expect(sent?.Content.Simple.Body.Text).toBeUndefined();
  });

  it("sends HTML only through Resend when there is no text", async () => {
    postboxDown = true;
    await sendEmailHtml({ ...base, html });

    const [sent] = resendSent;
    expect(sent?.html).toBe(html);
    expect(sent && "text" in sent).toBe(false);
  });

  it("passes a given text part on to both providers", async () => {
    await sendEmailHtml({ ...base, html, text: "Ваш код 123456" });
    postboxDown = true;
    await sendEmailHtml({ ...base, html, text: "Ваш код 123456" });

    expect(postboxSent[0]?.Content.Simple.Body.Text?.Data).toBe(
      "Ваш код 123456",
    );
    expect(resendSent[0]?.text).toBe("Ваш код 123456");
  });
});
