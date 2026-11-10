// Vitrine de veille (étape 20), pilotage depuis le panneau « Partager »,
// partie pure : corps du PUT /api/vitrine/[id], nouvelle configuration,
// adresse affichée. Les écritures vivent dans vitrine_query.ts.
import { ID_PATTERN } from "./property_schema";
import type { VitrineConfig } from "./views";

export type VitrinePatch = { enabled?: boolean; welcomePageId?: string | null };

// Corps de PUT /api/vitrine/[id] : au moins un des deux champs, chacun lisible.
// welcomePageId null retire la page d'accueil. Sinon null (400).
export function parseVitrinePatch(body: Record<string, unknown> | null): VitrinePatch | null {
  if (!body) return null;
  const patch: VitrinePatch = {};
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return null;
    patch.enabled = body.enabled;
  }
  if ("welcomePageId" in body) {
    const id = body.welcomePageId;
    if (id !== null && (typeof id !== "string" || !ID_PATTERN.test(id))) return null;
    patch.welcomePageId = id;
  }
  return Object.keys(patch).length ? patch : null;
}

// Seul ce que le geste nomme change ; une base sans vitrine part d'une
// vitrine coupée sans page d'accueil.
export function applyVitrinePatch(current: VitrineConfig | undefined, patch: VitrinePatch): VitrineConfig {
  const base = current ?? { enabled: false, welcomePageId: null };
  return {
    enabled: patch.enabled ?? base.enabled,
    welcomePageId: patch.welcomePageId === undefined ? base.welcomePageId : patch.welcomePageId,
  };
}

// Adresse de la vitrine : sur le Mac, celle du site distant (règle de
// SiteAddress) ; sur l'instance web, le chemin seul, l'origine se lisant dans
// le navigateur (le serveur ne connaît pas le domaine derrière Coolify).
export function vitrineAddress(remote: string | null): string {
  return remote ? `${remote.replace(/\/+$/, "")}/veille` : "/veille";
}
