"use client";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@synoro/ui";
import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { authClient } from "~/auth/client";

/** Who is signed in, and the way out (the session is shared with the app). */
export function SignOut({ email }: { email: string }) {
  const router = useRouter();

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/login");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Выйти" onClick={signOut}>
          <LogOutIcon />
          <span className="truncate">{email}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
