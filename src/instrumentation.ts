// Appelé une fois au démarrage du serveur Next : purge de la corbeille
// (éléments de plus de 30 jours). L'autre déclencheur est l'ouverture de la
// corbeille (api/trash). Un échec ne doit pas empêcher le serveur de démarrer.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { purgeExpired } = await import("./lib/pages");
    const count = await purgeExpired();
    if (count) console.log(`Corbeille : ${count} élément(s) de plus de 30 jours purgé(s)`);
  } catch (error) {
    console.error("Purge de la corbeille au démarrage impossible :", error);
  }
}
