// Lien vers un bloc (étape 21, palier d) : `<origine>/page/<id>#<bloc>`. Pur, sans
// base ni DOM. L'identifiant du bloc ne change jamais quand le bloc voyage d'une
// page à l'autre (déplacement, palier c) : c'est lui qui permet de retrouver la
// page d'un lien devenu périmé.

// Même motif que `ROW_ID` de publication.ts. Les identifiants de bloc sont des
// UUID ; ce motif exclut tout ce qui casserait un attribut HTML ou un sélecteur.
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID.test(value);
}

// `origin` vient de `location.origin` sur le web, de `SYNC_REMOTE_URL` sur le Mac
// (jamais localhost) ; vide, l'adresse reste relative.
export function blockLinkUrl(origin: string, pageId: string, blockId: string): string {
  return `${origin.replace(/\/+$/, "")}/page/${pageId}#${blockId}`;
}

// Identifiant visé par `location.hash`, ou null si l'ancre n'en est pas un.
export function blockIdFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isBlockId(decoded) ? decoded : null;
}

// Le bloc figure-t-il dans ce corps (enfants et colonnes compris) ? Sert à savoir
// si l'identifiant a bien été enregistré, et non seulement posé par l'éditeur au
// chargement d'un corps ancien.
export function hasBlockId(body: unknown, id: string): boolean {
  if (!Array.isArray(body)) return false;
  return body.some((block) => {
    if (typeof block !== "object" || block === null) return false;
    const record = block as { id?: unknown; children?: unknown };
    return record.id === id || hasBlockId(record.children, id);
  });
}

type Dated = Date | string | number;

// Parmi les pages qui portent maintenant le bloc, celle à ouvrir : la modifiée en
// dernier, hors la page où le lien a déjà échoué. Normalement une seule candidate ;
// deux n'arrivent qu'après un déplacement interrompu (le doublon de BlockMove).
export function pickRelocated(rows: { id: string; updatedAt: Dated }[], currentId: string): string | null {
  let best: { id: string; time: number } | null = null;
  for (const row of rows) {
    if (row.id === currentId) continue;
    const time = new Date(row.updatedAt).getTime();
    if (!best || time > best.time) best = { id: row.id, time };
  }
  return best?.id ?? null;
}

// Pose `id` sur la première balise ouvrante d'un bout de HTML rendu : celle du
// bloc. Les blocs rendent tous un élément en tête (p, h2, li, details, figure…),
// ce qui évite de réécrire chaque cas du rendu public. HTML sans balise en tête
// ou identifiant douteux : rendu tel quel.
export function withBlockId(html: string, id: string): string {
  if (!isBlockId(id)) return html;
  const tag = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html);
  return tag ? `${tag[0]} id="${id}"${html.slice(tag[0].length)}` : html;
}
