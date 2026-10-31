// Appelé une fois au démarrage du serveur Next, avant toute requête.
// 1. En production (MIGRATE_ON_START=1) : migrations et compte unique (un échec
//    arrête le processus, voir db/bootstrap.ts).
// 2. Purge de la corbeille (éléments de plus de 30 jours). L'autre déclencheur
//    est l'ouverture de la corbeille (api/trash). Un échec n'empêche pas le
//    serveur de démarrer.
// 3. Nettoyage des médias inutilisés depuis 30 jours, aux mêmes moments.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.MIGRATE_ON_START === "1") {
    const { bootstrap } = await import("./db/bootstrap");
    await bootstrap();
  }
  try {
    const { purgeExpired } = await import("./lib/pages");
    const count = await purgeExpired();
    if (count) console.log(`Corbeille : ${count} élément(s) de plus de 30 jours purgé(s)`);
  } catch (error) {
    console.error("Purge de la corbeille au démarrage impossible :", error);
  }
  const { tryCleanMedia } = await import("./lib/media_cleanup_query");
  await tryCleanMedia();
}
