import { describe, expect, it } from "bun:test";

import { isAllowedAuthPath } from "./paths";

describe("isAllowedAuthPath", () => {
  it("serves code sign-in, sign-out and the health route", () => {
    for (const path of [
      "/api/account/ok",
      "/api/account/email-otp/send-verification-otp",
      "/api/account/sign-in/email-otp",
      "/api/account/sign-out",
    ]) {
      expect(isAllowedAuthPath(path)).toBe(true);
    }
  });

  it("refuses password sign-in, sign-up and the rest", () => {
    for (const path of [
      "/api/account/sign-in/email",
      "/api/account/sign-up/email",
      "/api/account/email-otp/verify-email",
      "/api/account/admin/set-role",
      "/api/account/ok/",
      "/api/accountok",
    ]) {
      expect(isAllowedAuthPath(path)).toBe(false);
    }
  });
});
