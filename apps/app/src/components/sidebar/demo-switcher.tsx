import type { DemoAccount } from "@synoro/auth/demo";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@synoro/ui";
import {
  BriefcaseIcon,
  type LucideIcon,
  UserCogIcon,
  UserIcon,
} from "lucide-react";

const ICONS: Record<DemoAccount["role"], LucideIcon> = {
  owner: BriefcaseIcon,
  admin: UserCogIcon,
  client: UserIcon,
};

/**
 * Demo stand only: look at the cabinet from every role. Plain links, not
 * `next/link`: `/auth/demo` is a route handler that sets the session cookie,
 * which must not be prefetched.
 */
export function DemoSwitcher({
  accounts,
  email,
}: {
  accounts: (DemoAccount & { key: string })[];
  email: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Демо: войти как</SidebarGroupLabel>
      <SidebarMenu>
        {accounts.map((account) => {
          const Icon = ICONS[account.role];
          return (
            <SidebarMenuItem key={account.key}>
              <SidebarMenuButton
                size="lg"
                tooltip={`${account.label} — ${account.name}`}
                isActive={account.email === email}
                render={
                  <a href={`/auth/demo?as=${account.key}`}>
                    <Icon />
                    <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate font-medium">
                        {account.label}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {account.name}
                      </span>
                    </div>
                  </a>
                }
              />
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
