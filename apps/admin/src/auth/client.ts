import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { AUTH_BASE_PATH } from "./paths";

export const authClient = createAuthClient({
  basePath: AUTH_BASE_PATH,
  plugins: [emailOTPClient()],
});
