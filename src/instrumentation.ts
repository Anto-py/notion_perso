// Appelé une fois au démarrage du serveur Next, avant toute requête.
// 1. En production (MIGRATE_ON_START=1) : migrations et compte unique (un échec
//    arrête le processus, voir db/bootstrap.ts).
// 2. Purge de la corbeille (éléments de plus de 30 jours). L'autre déclencheur
//    est l'ouverture de la corbeille (api/trash). Un échec n'empêche pas le
//    serveur de démarrer.
// 3. Nettoyage des médias inutilisés depuis 30 jours, aux mêmes moments ; sur
//    le Mac, quarantaine vidée de ses fichiers de plus de 30 jours.
// 4. Sur l'instance du Mac seulement (SYNC_REMOTE_URL posée) : la boucle de
//    synchronisation, un cycle au lancement puis toutes les 5 minutes.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.MIGRATE_ON_START === "1") {
    const { bootstrap } = await import("./db/bootstrap");
    await bootstrap();
  }
  const { tryPurgeExpired } = await import("./lib/media_cleanup_query");
  await tryPurgeExpired();
  const { purgeQuarantine } = await import("./lib/storage");
  await purgeQuarantine().catch((error) => console.error("Quarantaine des médias non vidée :", error));
  if (process.env.SYNC_REMOTE_URL) {
    const { startSyncLoop } = await import("./lib/sync_client");
    startSyncLoop();
  }
}
