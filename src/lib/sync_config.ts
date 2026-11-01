// Configuration de la synchronisation, à part du cycle (sync_client.ts) : les
// réglages (settings.ts) reconnaissent le Mac à elle, et le cycle lit les
// réglages ; ce module les sépare sans boucle d'imports.
export type SyncConfig = { remote: string; token: string };

// Posées par le lanceur de l'app Mac seulement ; le VPS et le serveur de
// développement n'en ont pas.
export function syncConfig(): SyncConfig | null {
  const remote = process.env.SYNC_REMOTE_URL;
  const token = process.env.SYNC_TOKEN;
  return remote && token ? { remote, token } : null;
}
