import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  Skeleton,
} from "@synoro/ui";
import { type ReactNode, Suspense } from "react";

import { requireAdmin } from "~/auth/server";
import { AdminSidebar } from "~/components/sidebar/admin-sidebar";

/**
 * The frame is prerendered; the sidebar (current path, signed-in admin)
 * streams in. Each page checks `requireAdmin()` itself too, before reading
 * any data.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <Suspense fallback={<SidebarSkeleton />}>
        <SessionSidebar />
      </Suspense>
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  );
}

async function SessionSidebar() {
  const session = await requireAdmin();
  return <AdminSidebar email={session.user.email} />;
}

function SidebarSkeleton() {
  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="gap-2 p-2">
        {["70%", "55%", "80%", "60%"].map((width) => (
          <div key={width} className="flex h-8 items-center gap-2 px-2">
            <Skeleton className="size-4 rounded-md" />
            <Skeleton className="h-4" style={{ width }} />
          </div>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
