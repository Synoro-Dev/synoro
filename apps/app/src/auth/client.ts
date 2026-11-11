import { paths } from "@synoro/config";
import { adminClient, emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: paths.api.auth,
  plugins: [emailOTPClient(), adminClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
