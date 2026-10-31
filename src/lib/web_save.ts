// Contrôle de version à l'enregistrement web (SPECS.md, « Synchronisation
// avec l'app Mac », « Enregistrement web »). Module pur, partagé par le
// serveur et le navigateur : ni base, ni réseau, ni éditeur.
//
// Le navigateur envoie, avec ce qu'il enregistre, la révision qu'il a lue ;
// si la ligne a bougé depuis, il renvoie aussi sa base (la dernière version
// que le serveur lui a confirmée) et le serveur fusionne. L'enregistrement
// qui arrive est toujours le plus récent : sur un même bloc il gagne, et la
// version du serveur reste juste en dessous, encadrée.
import { mergeBody, sameJson } from "./sync_merge";

export type WebFields = { title?: string; body?: unknown[] };
export type ServerFields = { title: string; body: unknown; updatedAt: string };

// Serveur : ce qui s'écrit quand la ligne a bougé depuis la base du
// navigateur. Le titre est un seul champ : la frappe qui arrive l'emporte.
export function mergeWebSave(
  base: WebFields,
  patch: WebFields,
  server: ServerFields,
  now: string,
  makeId?: () => string,
): { fields: WebFields; conflicts: number } {
  const fields: WebFields = {};
  let conflicts = 0;
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.body !== undefined) {
    const merged = mergeBody(base.body ?? null, patch.body, server.body, {
      mineNewer: true,
      dates: { mine: now, theirs: server.updatedAt },
      origins: { mine: "web", theirs: "other" },
      makeId,
    });
    fields.body = merged.body;
    conflicts = merged.conflicts;
  }
  return { fields, conflicts };
}

// Navigateur : le serveur a renvoyé une version fusionnée de ce qui était
// parti (sent), mais l'éditeur a continué de recevoir des frappes (current).
// Ces frappes se reposent sur la version fusionnée, à trois versions encore.
export function rebaseTyping(sent: unknown[], current: unknown[], merged: unknown[], now: string, makeId?: () => string): unknown[] {
  if (sameJson(current, sent)) return merged;
  return mergeBody(sent, current, merged, {
    mineNewer: true,
    dates: { mine: now, theirs: now },
    origins: { mine: "web", theirs: "other" },
    makeId,
  }).body;
}

// --- Remplacement minimal dans l'éditeur -------------------------------------
//
// Remplacer tout le document ferait sauter le curseur. Les blocs de premier
// niveau identiques (même id, même contenu) restent en place ; seuls les
// passages qui diffèrent sont remplacés. Le bloc où l'on tape a changé de ce
// côté-ci : il gagne la fusion, reste identique et garde le curseur.

type Block = { id: string } & Record<string, unknown>;

// Un passage à remplacer : les blocs à retirer, ceux à mettre à la place, et
// les blocs gardés qui l'encadrent (null au bord du document).
export type Run = { remove: string[]; insert: unknown[]; after: string | null; before: string | null };

const idOf = (block: unknown): string | null =>
  typeof block === "object" && block !== null && typeof (block as Block).id === "string" ? (block as Block).id : null;

function same(a: unknown, b: unknown): boolean {
  const id = idOf(a);
  return id !== null && id === idOf(b) && sameJson(a, b);
}

export function planBlockRuns(current: readonly unknown[], target: readonly unknown[]): Run[] {
  // Préfixe et suffixe communs d'abord : la plupart des fusions ne touchent
  // que quelques blocs, la plus longue sous-suite commune reste petite.
  let start = 0;
  while (start < current.length && start < target.length && same(current[start], target[start])) start++;
  let endC = current.length;
  let endT = target.length;
  while (endC > start && endT > start && same(current[endC - 1], target[endT - 1])) {
    endC--;
    endT--;
  }

  const c = current.slice(start, endC);
  const t = target.slice(start, endT);
  // Plus longue sous-suite commune de blocs identiques, par programmation
  // dynamique : lcs[i][j] pour c[i:] et t[j:].
  const width = t.length + 1;
  const lcs = new Uint32Array((c.length + 1) * width);
  for (let i = c.length - 1; i >= 0; i--) {
    for (let j = t.length - 1; j >= 0; j--) {
      lcs[i * width + j] = same(c[i], t[j]) ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const runs: Run[] = [];
  let after = start > 0 ? idOf(current[start - 1]) : null;
  let remove: string[] = [];
  let insert: unknown[] = [];
  const close = (before: string | null) => {
    if (remove.length || insert.length) runs.push({ remove, insert, after, before });
    remove = [];
    insert = [];
  };
  let i = 0;
  let j = 0;
  while (i < c.length || j < t.length) {
    if (i < c.length && j < t.length && same(c[i], t[j])) {
      const id = idOf(c[i]);
      close(id);
      after = id;
      i++;
      j++;
    } else if (j >= t.length || (i < c.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      const id = idOf(c[i]);
      if (id) remove.push(id);
      i++;
    } else {
      insert.push(t[j]);
      j++;
    }
  }
  close(endC < current.length ? idOf(current[endC]) : null);
  return runs;
}
