import { Suspense } from "react";
import { AccountSection } from "@/components/settings/AccountSection";
import { AgentSection } from "@/components/settings/AgentSection";
import { BackupsSection } from "@/components/settings/BackupsSection";
import { DevicesSection } from "@/components/settings/DevicesSection";
import { PublicViewSection } from "@/components/settings/PublicViewSection";
import { SiteAddress } from "@/components/settings/SiteAddress";
import { SyncSection } from "@/components/settings/SyncSection";
import { VersionSection } from "@/components/settings/VersionSection";
import { listAgentLog } from "@/lib/agent_log";
import { listAgentTokens } from "@/lib/agent_tokens";
import { canSwitchVersion } from "@/lib/app_version";
import { getCurrentUser } from "@/lib/auth";
import { backupDir, listBackups, readOpenBackup } from "@/lib/backups";
import { serverDumpConfigured } from "@/lib/server_dump";
import { currentInstance, getSetting } from "@/lib/settings";
import { sectionsFor, SYNC_THRESHOLD_DEFAULT, type SettingsSection } from "@/lib/settings_rules";
import { listClients } from "@/lib/sync_clients";
import { syncConfig } from "@/lib/sync_config";
import { readThreshold } from "@/lib/sync_suspension";

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
  const instance = currentInstance();
  const sections = sectionsFor(instance);
  return (
    <>
      {/* L'adresse web de l'installation : sur le Mac, celle du site distant
          (`SYNC_REMOTE_URL`), jamais localhost ; sur l'instance web, l'origine
          de la page. */}
      <SiteAddress webAddress={instance === "mac" ? (syncConfig()?.remote ?? "") : ""} />
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
      return <VersionSection switchable={canSwitchVersion()} />;
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
    case "agent": {
      const [tokens, log] = await Promise.all([listAgentTokens(), listAgentLog()]);
      return (
        <AgentSection
          tokens={tokens.map((token) => ({
            id: token.id,
            name: token.name,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
            revokedAt: token.revokedAt?.toISOString() ?? null,
          }))}
          log={log.map((entry) => ({
            id: entry.id,
            at: entry.at.toISOString(),
            tokenName: entry.tokenName,
            model: entry.model,
            action: entry.action,
            pageTitle: entry.pageTitle,
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
    case "synchronisation": {
      // L'adresse seule, jamais le jeton.
      const remote = syncConfig()?.remote ?? "";
      return <SyncSection remote={remote} threshold={await readThreshold()} thresholdDefault={SYNC_THRESHOLD_DEFAULT} />;
    }
    case "sauvegardes": {
      const [backups, open, trial, serverCopy] = await Promise.all([
        listBackups(),
        readOpenBackup(),
        getSetting("backup.trial"),
        getSetting("backup.server"),
      ]);
      return (
        <BackupsSection
          dir={backupDir()}
          backups={backups}
          open={open}
          trial={trial}
          server={{ configured: serverDumpConfigured(), copy: serverCopy }}
        />
      );
    }
  }
}
