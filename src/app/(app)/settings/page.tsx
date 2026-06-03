import { AiProviderSettings } from '@/components/integrations/ai-providers/AiProviderSettings';
import { GoogleDriveSettings } from '@/components/integrations/google-drive/GoogleDriveSettings';
import { HeadlessTokenSettings } from '@/components/integrations/headless-tokens/HeadlessTokenSettings';

export default function SettingsPage() {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage connected integrations.</p>
      </div>

      <AiProviderSettings />
      <GoogleDriveSettings />
      <HeadlessTokenSettings />
    </section>
  );
}
