import { Suspense } from "react";
import { BillingPanel } from "~/components/billing/billing-panel";
import {
  SettingsFormSkeleton,
  SettingsHeader,
  SettingsShell,
} from "~/components/settings/settings-shell";
import { SettingsSidebar } from "~/components/settings/settings-sidebar";

export default function SettingsBillingPage() {
  return (
    <SettingsShell header={<SettingsHeader />} sidebar={<SettingsSidebar />}>
      {/* The panel reads `?payment=` after the bank's redirect back. */}
      <Suspense fallback={<SettingsFormSkeleton />}>
        <BillingPanel />
      </Suspense>
    </SettingsShell>
  );
}
