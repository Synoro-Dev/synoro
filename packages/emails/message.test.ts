import { describe, expect, it } from "bun:test";
import { createElement } from "react";

import { postboxBody, renderParts, resendPayload } from "./message";

const mail = {
  from: "Synoro <info@synoro.ru>",
  to: ["anna@example.com"],
  subject: "Код для входа в Synoro",
  html: "<p>Ваш код 123456</p>",
};

describe("renderParts", () => {
  it("renders the HTML and a text twin that keeps the code and the link", async () => {
    const { html, text } = await renderParts(
      createElement(
        "div",
        null,
        createElement("p", null, "Ваш код 123456"),
        createElement(
          "a",
          { href: "https://synoro.ru/reset?t=abc" },
          "Сбросить",
        ),
      ),
    );

    expect(html).toContain("<p");
    expect(text).toContain("123456");
    expect(text).toContain("https://synoro.ru/reset?t=abc");
    expect(text).not.toContain("<");
  });
});

describe("postboxBody", () => {
  it("sends the text part next to the HTML", () => {
    expect(postboxBody({ html: mail.html, text: "Ваш код 123456" })).toEqual({
      Html: { Data: mail.html, Charset: "UTF-8" },
      Text: { Data: "Ваш код 123456", Charset: "UTF-8" },
    });
  });

  it("leaves Text out when the mail has none (sendEmailHtml)", () => {
    expect(postboxBody({ html: mail.html })).toEqual({
      Html: { Data: mail.html, Charset: "UTF-8" },
    });
  });
});

describe("resendPayload", () => {
  it("passes the text part on", () => {
    expect(resendPayload({ ...mail, text: "Ваш код 123456" })).toEqual({
      ...mail,
      text: "Ваш код 123456",
    });
  });

  it("has no text key when the mail has none (sendEmailHtml)", () => {
    expect(resendPayload(mail)).toEqual(mail);
    expect("text" in resendPayload(mail)).toBe(false);
  });
});
