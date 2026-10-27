import { describe, expect, test } from "bun:test";
import { accountFormSchema } from "./account";
import {
  availabilityFormSchema,
  creditGrantFormSchema,
  freeConsultationFormSchema,
  normalizeHostname,
  practiceFormSchema,
} from "./booking";
import { loginFormSchema } from "./login";
import { otpFormSchema } from "./otp";
import { changePasswordFormSchema } from "./password";
import { profileFormSchema } from "./profile";

describe("profileFormSchema", () => {
  test("accepts a valid profile", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "jane@example.com",
      bio: "hello",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a too-short username", () => {
    const result = profileFormSchema.safeParse({
      username: "j",
      email: "jane@example.com",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid email", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a bio longer than 160 chars", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "jane@example.com",
      bio: "x".repeat(161),
    });
    expect(result.success).toBe(false);
  });
});

describe("accountFormSchema", () => {
  test("accepts a valid account", () => {
    const result = accountFormSchema.safeParse({
      name: "Jane",
      language: "en",
    });
    expect(result.success).toBe(true);
  });

  test("language is optional", () => {
    const result = accountFormSchema.safeParse({ name: "Jane" });
    expect(result.success).toBe(true);
  });

  test("rejects a too-short name", () => {
    const result = accountFormSchema.safeParse({ name: "J" });
    expect(result.success).toBe(false);
  });
});

describe("loginFormSchema", () => {
  test("accepts a valid email", () => {
    expect(loginFormSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });

  test("rejects an empty email", () => {
    expect(loginFormSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("otpFormSchema", () => {
  test("accepts a 6-digit code", () => {
    expect(otpFormSchema.safeParse({ otp: "123456" }).success).toBe(true);
  });

  test("rejects non-digit codes", () => {
    expect(otpFormSchema.safeParse({ otp: "12345a" }).success).toBe(false);
  });

  test("rejects codes that are not exactly 6 digits", () => {
    expect(otpFormSchema.safeParse({ otp: "12345" }).success).toBe(false);
  });
});

describe("changePasswordFormSchema", () => {
  const valid = {
    currentPassword: "old-password",
    newPassword: "new-password-1",
    confirmPassword: "new-password-1",
    revokeOtherSessions: true,
  };

  test("accepts a valid password change", () => {
    expect(changePasswordFormSchema.safeParse(valid).success).toBe(true);
  });

  test("requires the current password", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      currentPassword: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a new password shorter than 8 characters", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a new password longer than 128 characters", () => {
    const long = "x".repeat(129);
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      newPassword: long,
      confirmPassword: long,
    });
    expect(result.success).toBe(false);
  });

  test("rejects mismatched confirmation on the confirm field", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      confirmPassword: "different-password",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });

  test("rejects reusing the current password", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      newPassword: valid.currentPassword,
      confirmPassword: valid.currentPassword,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["newPassword"]);
  });
});

describe("practiceFormSchema", () => {
  test("lowercases and accepts a valid slug", () => {
    const result = practiceFormSchema.parse({
      name: "Психолог Анна",
      slug: "Anna-Psy",
    });
    expect(result.slug).toBe("anna-psy");
  });

  test("rejects a slug with a leading dash or Cyrillic", () => {
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "-anna" }).success,
    ).toBe(false);
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "анна" }).success,
    ).toBe(false);
  });
});

describe("availabilityFormSchema", () => {
  test("rejects more than 168 non-overlapping intervals", () => {
    const rules = Array.from({ length: 169 }, (_, i) => ({
      weekday: Math.floor(i / 48) + 1,
      startMinute: (i % 48) * 30,
      endMinute: (i % 48) * 30 + 30,
    }));
    const result = availabilityFormSchema.safeParse({ rules });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: "too_big", path: ["rules"] }),
    );
  });

  test("accepts non-overlapping half-hour intervals", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [
        { weekday: 1, startMinute: 600, endMinute: 780 },
        { weekday: 1, startMinute: 900, endMinute: 1140 },
        { weekday: 2, startMinute: 600, endMinute: 1440 },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects intervals off the 30-minute grid", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [{ weekday: 1, startMinute: 615, endMinute: 780 }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects an interval that ends before it starts", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [{ weekday: 3, startMinute: 780, endMinute: 600 }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects overlapping intervals on the same day", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [
        { weekday: 1, startMinute: 600, endMinute: 780 },
        { weekday: 1, startMinute: 720, endMinute: 900 },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("practiceFormSchema reserved slugs", () => {
  test("rejects slugs reserved for platform subdomains", () => {
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "www" }).success,
    ).toBe(false);
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "API" }).success,
    ).toBe(false);
  });
});

describe("normalizeHostname", () => {
  test("strips scheme, path, port and trailing dot", () => {
    expect(normalizeHostname(" https://Anna-Psy.ru/zapis?x=1 ")).toBe(
      "anna-psy.ru",
    );
    expect(normalizeHostname("zapis.anna.ru:443")).toBe("zapis.anna.ru");
    expect(normalizeHostname("anna.ru.")).toBe("anna.ru");
  });

  test("converts Cyrillic domains to punycode", () => {
    expect(normalizeHostname("Анна.рф")).toBe("xn--80aa2ba.xn--p1ai");
  });

  test("rejects non-hosts", () => {
    for (const value of [
      "",
      "anna",
      "localhost",
      "1.2.3.4",
      "a b.ru",
      "-a.ru",
    ]) {
      expect(normalizeHostname(value)).toBeNull();
    }
  });
});

describe("creditGrantFormSchema", () => {
  test("accepts positive and negative amounts", () => {
    expect(creditGrantFormSchema.safeParse({ delta: 5 }).success).toBe(true);
    expect(creditGrantFormSchema.safeParse({ delta: -2 }).success).toBe(true);
  });

  test("rejects zero and fractions", () => {
    expect(creditGrantFormSchema.safeParse({ delta: 0 }).success).toBe(false);
    expect(creditGrantFormSchema.safeParse({ delta: 1.5 }).success).toBe(false);
  });
});

describe("freeConsultationFormSchema", () => {
  test("requires a guest name", () => {
    expect(
      freeConsultationFormSchema.safeParse({ guestName: "  " }).success,
    ).toBe(false);
    expect(
      freeConsultationFormSchema.safeParse({
        guestName: "Иван",
        guestContact: "+7 900 000-00-00",
      }).success,
    ).toBe(true);
  });
});
