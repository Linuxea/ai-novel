import { env } from "@/env";
import { SettingsForm } from "@/components/settings/settings-form";

export default async function SettingsPage() {
  return <SettingsForm defaultModel={env.AI_MODEL} />;
}
