// Appelé une fois au démarrage du serveur Next, avant toute requête.
// 1. En production (MIGRATE_ON_START=1) : migrations et compte unique (un échec
//    arrête le processus, voir db/bootstrap.ts).
// 1 bis. Sur une instance sans SYNC_REMOTE_URL (serveur, développement) :
//    déménagement des bases dans « Bases » (étape 16, palier c), puis conversion
//    de la racine sur la page « Bases de données » (étape 17, palier c).
//    Idempotents : un démarrage ordinaire ne trouve rien. La conversion ne
//    tourne qu'une fois, tant que le rôle est porté par un dossier : après elle,
//    `basesPageConverted` est vrai et plus rien ne se rejoue. Le Mac reçoit le
//    résultat par la synchronisation. Un échec n'empêche pas le démarrage.
//    Ensuite, une seule fois (marqueur `conversion.bases_liens`), les bases
//    encastrées de cette page deviennent des liens icône + nom (2026-11-11).
// 2. Purge de la corbeille (éléments de plus de 30 jours). L'autre déclencheur
//    est l'ouverture de la corbeille (api/trash). Un échec n'empêche pas le
//    serveur de démarrer.
// 3. Nettoyage des médias inutilisés depuis 30 jours, aux mêmes moments ; sur
//    le Mac, quarantaine vidée de ses fichiers de plus de 30 jours.
// 4. Sur l'instance du Mac seulement (SYNC_REMOTE_URL posée) : la boucle de
//    synchronisation, un cycle au lancement puis toutes les 5 minutes.
// 5 et 6. Sur le Mac (BACKUP_DIR posé) : copie du dump du serveur, restauration
//    d'essai.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.MIGRATE_ON_START === "1") {
    const { bootstrap } = await import("./db/bootstrap");
    await bootstrap();
  }
  if (!process.env.SYNC_REMOTE_URL) {
    const [
      { db },
      { describeRun, runBasesMove },
      { basesPageConverted, describeConversion, runBasesPageMove },
      { describeInboxPlan, inboxPageConverted, runInboxPageMove },
    ] = await Promise.all([
      import("./db"),
      import("./lib/bases_move_query"),
      import("./lib/bases_page_move_query"),
      import("./lib/inbox_page_move_query"),
    ]);
    await runBasesMove(db, { write: true }).then(
      (run) => console.log(describeRun(run)),
      (error) => console.error("Déménagement vers « Bases » impossible :", error),
    );
    if (!(await basesPageConverted(db))) {
      await runBasesPageMove(db, { write: true }).then(
        (run) => console.log(describeConversion(run)),
        (error) => console.error("Conversion de la racine des bases impossible :", error),
      );
    }
    // Après la racine : les bases encastrées de la page deviennent des liens
    // icône + nom (2026-11-11). Une fois, le marqueur l'empêche de se rejouer.
    const { basesLinksDone, describeLinksRun, runBasesLinks } = await import("./lib/bases_links_query");
    if (!(await basesLinksDone(db))) {
      await runBasesLinks(db, { write: true }).then(
        (run) => console.log(describeLinksRun(run)),
        (error) => console.error("Bases en liens impossibles :", error),
      );
    }
    if (!(await inboxPageConverted(db))) {
      await runInboxPageMove(db, { write: true }).then(
        (run) => console.log(describeInboxPlan(run.plan)),
        (error) => console.error("Conversion du Vide-cerveau impossible :", error),
      );
    }
  }
  const { tryPurgeExpired } = await import("./lib/media_cleanup_query");
  await tryPurgeExpired();
  const { purgeQuarantine } = await import("./lib/storage");
  await purgeQuarantine().catch((error) => console.error("Quarantaine des médias non vidée :", error));
  if (process.env.SYNC_REMOTE_URL) {
    const { startSyncLoop } = await import("./lib/sync_client");
    startSyncLoop();
  }
  // 5. Copie du dump nocturne du serveur (palier f), au démarrage puis toutes
  //    les 6 h, sans retarder le service. Le module s'arrête seul hors du Mac.
  if (process.env.BACKUP_DIR && process.env.SERVER_DUMP_HOST) {
    void import("./lib/server_dump")
      .then(({ startServerDumpLoop }) => startServerDumpLoop())
      .catch((error) => console.error("Copie du serveur impossible :", error));
  }
  // 6. Restauration d'essai (palier e), une minute après le démarrage : elle ne
  //    retarde pas le service. Le module s'arrête seul hors du Mac.
  if (process.env.BACKUP_DIR) {
    setTimeout(() => {
      void import("./lib/backup_trial")
        .then(({ runTrialIfDue }) => runTrialIfDue())
        .catch((error) => console.error("Restauration d'essai impossible :", error));
    }, 60_000).unref();
  }
}
