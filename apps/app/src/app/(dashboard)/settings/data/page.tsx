import { DataSettings } from "~/components/settings/data-settings";
import {
  SettingsHeader,
  SettingsShell,
} from "~/components/settings/settings-shell";
import { SettingsSidebar } from "~/components/settings/settings-sidebar";

export default function SettingsDataPage() {
  return (
    <SettingsShell header={<SettingsHeader />} sidebar={<SettingsSidebar />}>
      <DataSettings />
    </SettingsShell>
  );
}
