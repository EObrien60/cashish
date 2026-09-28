import { withTenant } from "@/lib/request-context";
import { getSettings, listCategories, listVatRates } from "@/lib/lookups";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { SettingsView } from "@/components/SettingsView";
import { ownShopPath } from "@/lib/shop";
import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return withTenant(async () => {
    const [settings, categories, vatRates, shopPath] = await Promise.all([
      getSettings(),
      listCategories(),
      listVatRates(),
      ownShopPath(),
    ]);

    return (
      <div>
        <PageHeader
          title="Settings"
          subtitle="Your business details, invoice numbering and categories."
        />
        <SettingsTabs />
        <SettingsView
          settings={settings}
          categories={categories}
          vatRates={vatRates}
          shopUrl={`${appOrigin()}${shopPath}`}
        />
      </div>
    );
  });
}
