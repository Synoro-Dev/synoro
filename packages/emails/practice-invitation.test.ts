import { describe, expect, it } from "bun:test";
import PracticeInvitationEmail from "./emails/practice-invitation";
import { renderParts } from "./message";

describe("PracticeInvitationEmail", () => {
  it("names the practice and leads to the page where it is accepted", async () => {
    const { text } = await renderParts(
      PracticeInvitationEmail({
        practiceName: "Анна Иванова",
        inviterName: "Анна",
        role: "client",
        acceptUrl: "https://app.synoro.ru/practices",
      }),
    );

    expect(text).toContain("Анна Иванова");
    expect(text).toContain("клиентом");
    expect(text).toContain("https://app.synoro.ru/practices");
  });
});
