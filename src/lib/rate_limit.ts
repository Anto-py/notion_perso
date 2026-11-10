// Limiteur des routes publiques de la vitrine : un compteur par clé (l'IP)
// et par fenêtre fixe, en mémoire. Un redémarrage remet tout à zéro, ce qui
// suffit à freiner un robot sans rien stocker.
export type RateLimit = {
  // retryAfter : millisecondes avant la prochaine requête admise, 0 si admise.
  take(key: string): { ok: boolean; retryAfter: number };
  // Requêtes encore admises dans la fenêtre en cours, sans en consommer.
  remaining(key: string): number;
  size(): number;
};

export function createRateLimit({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimit {
  const windows = new Map<string, { start: number; count: number }>();

  // Balayage seulement quand la table grossit : une IP de passage ne reste
  // pas indéfiniment.
  function sweep(at: number) {
    for (const [key, window] of windows) if (at - window.start >= windowMs) windows.delete(key);
  }

  return {
    take(key) {
      const at = now();
      let window = windows.get(key);
      if (!window || at - window.start >= windowMs) {
        if (!window && windows.size >= maxKeys) sweep(at);
        window = { start: at, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= limit) return { ok: false, retryAfter: window.start + windowMs - at };
      window.count++;
      return { ok: true, retryAfter: 0 };
    },
    remaining(key) {
      const window = windows.get(key);
      if (!window || now() - window.start >= windowMs) return limit;
      return Math.max(0, limit - window.count);
    },
    size: () => windows.size,
  };
}

// Instance partagée par nom : Next charge parfois un module deux fois, et un
// compteur de module se dédoublerait (piège mesuré, voir AGENTS.md).
const shared = globalThis as typeof globalThis & { __npRateLimits?: Map<string, RateLimit> };

export function sharedRateLimit(name: string, options: { limit: number; windowMs: number }): RateLimit {
  shared.__npRateLimits ??= new Map();
  let instance = shared.__npRateLimits.get(name);
  if (!instance) {
    instance = createRateLimit(options);
    shared.__npRateLimits.set(name, instance);
  }
  return instance;
}

// Réponse 429 avec Retry-After en secondes, arrondi vers le haut.
export function tooManyRequests(retryAfterMs: number): Response {
  return Response.json(
    { error: "Trop de requêtes, réessayez dans un instant." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
  );
}
