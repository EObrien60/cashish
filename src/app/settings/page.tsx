import { withTenant } from "@/lib/request-context";
import { getSettings, listCategories, listVatRates } from "@/lib/lookups";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { SettingsView } from "@/components/SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return withTenant(async () => {
    const [settings, categories, vatRates] = await Promise.all([
      getSettings(),
      listCategories(),
      listVatRates(),
    ]);

    return (
      <div>
        <PageHeader
          title="Settings"
          subtitle="Your business details, invoice numbering and categories."
        />
        <SettingsTabs />
        <SettingsView settings={settings} categories={categories} vatRates={vatRates} />
      </div>
    );
  });
}
