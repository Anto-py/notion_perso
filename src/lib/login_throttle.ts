// Limite les tentatives de connexion par clé (l'adresse IP). En mémoire : un
// redémarrage remet les compteurs à zéro, ce qui suffit pour un compte unique.
export type LoginThrottle = {
  // Millisecondes à attendre avant une nouvelle tentative, 0 si permise.
  retryAfter(key: string): number;
  recordFailure(key: string): void;
  reset(key: string): void;
};

export function createLoginThrottle({
  maxFailures = 5,
  windowMs = 15 * 60_000,
  now = Date.now,
}: { maxFailures?: number; windowMs?: number; now?: () => number } = {}): LoginThrottle {
  const failures = new Map<string, number[]>();

  // Ne garde que les échecs encore dans la fenêtre glissante.
  function recent(key: string): number[] {
    const since = now() - windowMs;
    const kept = (failures.get(key) ?? []).filter((t) => t > since);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  }

  return {
    retryAfter(key) {
      const kept = recent(key);
      if (kept.length < maxFailures) return 0;
      // Débloqué quand le plus ancien des échecs comptés sort de la fenêtre.
      return kept[kept.length - maxFailures] + windowMs - now();
    },
    recordFailure(key) {
      failures.set(key, [...recent(key), now()]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
