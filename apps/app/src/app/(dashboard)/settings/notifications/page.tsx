import { MessengerSettings } from "~/components/settings/messenger-notifications";
import {
  SettingsHeader,
  SettingsShell,
} from "~/components/settings/settings-shell";
import { SettingsSidebar } from "~/components/settings/settings-sidebar";

export default function SettingsNotificationsPage() {
  return (
    <SettingsShell header={<SettingsHeader />} sidebar={<SettingsSidebar />}>
      <MessengerSettings />
    </SettingsShell>
  );
}
