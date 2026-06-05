import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { SettingsView } from "@/components/SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  boot();
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()!;
  const categories = db
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.name)
    .all();
  const vatRates = db
    .select()
    .from(schema.vatRates)
    .orderBy(schema.vatRates.sortOrder)
    .all();

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Your business details, invoice numbering and categories."
      />
      <SettingsView settings={settings} categories={categories} vatRates={vatRates} />
    </div>
  );
}
