import { Suspense } from "react";
import { AccountSection } from "@/components/settings/AccountSection";
import { DevicesSection } from "@/components/settings/DevicesSection";
import { PublicViewSection } from "@/components/settings/PublicViewSection";
import { VersionSection } from "@/components/settings/VersionSection";
import { getCurrentUser } from "@/lib/auth";
import { currentInstance, getSetting } from "@/lib/settings";
import { sectionsFor, type SettingsSection } from "@/lib/settings_rules";
import { listClients } from "@/lib/sync_clients";

// Réglages de cette instance (BRAINSTORMING §12) : chaque instance n'affiche
// que ses sections, jamais un secret. Chaque section porte un id, pour qu'un
// lien mène droit à elle (/reglages#sauvegardes).
export default function SettingsPage() {
  return (
    <main className="page settings">
      <h1>Réglages</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <SettingsData />
      </Suspense>
    </main>
  );
}

async function SettingsData() {
  const user = await getCurrentUser();
  const sections = sectionsFor(currentInstance());
  return (
    <>
      {sections.map((section) => (
        <Section key={section} section={section} username={user.username} />
      ))}
    </>
  );
}

async function Section({ section, username }: { section: SettingsSection; username: string }) {
  switch (section) {
    case "compte":
      return <AccountSection username={username} />;
    case "version":
      return <VersionSection />;
    case "appareils": {
      const clients = await listClients();
      return (
        <DevicesSection
          clients={clients.map((client) => ({
            id: client.id,
            name: client.name,
            lastSeenAt: client.lastSeenAt?.toISOString() ?? null,
          }))}
        />
      );
    }
    case "vue_publique": {
      const [siteName, linkedinUrl] = await Promise.all([
        getSetting("public.site_name"),
        getSetting("public.linkedin_url"),
      ]);
      return (
        <PublicViewSection
          siteName={siteName ?? ""}
          linkedinUrl={linkedinUrl ?? ""}
          fallbackSiteName={process.env.SITE_NAME?.trim() || "notion_perso"}
        />
      );
    }
    // Synchronisation et Sauvegardes (Mac) : paliers b à e de l'étape 12.
    case "synchronisation":
    case "sauvegardes":
      return null;
  }
}
