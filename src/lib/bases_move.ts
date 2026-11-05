// Déménagement des bases vers « Bases » (étape 16, palier c ; SPECS « Dossier
// « Bases » », ligne « Déménagement »). Module pur : il dit ce qu'il faut
// écrire, sans base ni disque. Trois appelants : le démarrage du serveur
// (bases_move_query.ts), l'import Notion (notion-import.ts, cible = dossier
// d'import) et la reprise d'une sauvegarde (backup_restore_plan.ts).
//
// Extensions .ts explicites : npm run bases:demenager tourne sous Node seul.
import { BASES_ROOT_ID, type PageKind } from "./bases.ts";
import { LINKED_BLOCK, SUBPAGE_BLOCK } from "./blocks.ts";

type Json = unknown;
type Block = Record<string, Json>;

export type MoveRow = {
  id: string;
  type: PageKind;
  parentId: string | null;
  // Lu seulement pour l'ancien parent d'une base qui déménage.
  body: Json;
  trashed: boolean;
  title?: string;
  isInbox?: boolean;
};

export type MoveOptions = {
  // Dossier d'arrivée ; la racine de « Bases » par défaut.
  target?: string;
  // Parent absent des lignes fournies (reprise d'une sauvegarde : le parent
  // vit dans la base vive) : est-il un dossier de « Bases » ?
  isFolder?: (id: string) => boolean;
};

export type MovedBase = {
  id: string;
  title: string;
  trashed: boolean;
  // Ancien parent, et ce que son corps a reçu.
  hostId: string | null;
  action: "converted" | "added" | "none";
};

export type BasesMovePlan = {
  target: string;
  // Dans l'ordre d'arrivée : Vide-cerveau d'abord, puis par titre.
  moved: MovedBase[];
  // Corps réécrits des anciens parents, par id.
  bodies: Map<string, Json[]>;
  report: { moved: number; trashed: number; converted: number; added: number };
};

const isObject = (value: Json): value is Block => typeof value === "object" && value !== null && !Array.isArray(value);

const propsOf = (block: Block): Block => (isObject(block.props) ? block.props : {});

export function linkedBlockFor(databaseId: string, id: string = `linked-${databaseId}`): Block {
  return { id, type: LINKED_BLOCK, props: { databaseId, config: "" }, children: [] };
}

// Un bloc de sous-page propriétaire (« Base » du menu, import) qui cite la
// base devient une vue liée de même id ; un lien ↗ (link: true) reste un lien.
function convertOwners(body: Json[], databaseId: string): { body: Json[]; count: number } {
  let count = 0;
  const visit = (blocks: Json): Json => {
    if (!Array.isArray(blocks)) return blocks;
    return blocks.map((block) => {
      if (!isObject(block)) return block;
      const props = propsOf(block);
      if (block.type === SUBPAGE_BLOCK && props.pageId === databaseId && props.link !== true) {
        count++;
        const linked = linkedBlockFor(databaseId, typeof block.id === "string" ? block.id : undefined);
        return Array.isArray(block.children) ? { ...linked, children: visit(block.children) } : linked;
      }
      return "children" in block ? { ...block, children: visit(block.children) } : block;
    });
  };
  return { body: visit(body) as Json[], count };
}

function hasLinked(body: Json, databaseId: string): boolean {
  if (!Array.isArray(body)) return false;
  return body.some(
    (block) =>
      isObject(block) &&
      ((block.type === LINKED_BLOCK && propsOf(block).databaseId === databaseId) || hasLinked(block.children, databaseId)),
  );
}

export function planBasesMove(rows: readonly MoveRow[], options: MoveOptions = {}): BasesMovePlan {
  const target = options.target ?? BASES_ROOT_ID;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const isFolder = (id: string): boolean => {
    const row = byId.get(id);
    return row ? row.type === "folder" : (options.isFolder?.(id) ?? false);
  };

  const outside = rows
    .filter((row) => row.type === "database" && !(row.parentId && isFolder(row.parentId)))
    .sort(
      (a, b) =>
        Number(Boolean(b.isInbox)) - Number(Boolean(a.isInbox)) ||
        (a.title ?? "").localeCompare(b.title ?? "", "fr") ||
        a.id.localeCompare(b.id),
    );

  const bodies = new Map<string, Json[]>();
  const report = { moved: 0, trashed: 0, converted: 0, added: 0 };
  const moved: MovedBase[] = [];

  for (const base of outside) {
    const host = base.parentId ? byId.get(base.parentId) : undefined;
    let action: MovedBase["action"] = "none";
    if (host && host.type !== "folder") {
      const current = bodies.get(host.id) ?? (Array.isArray(host.body) ? host.body : []);
      const { body, count } = convertOwners(current, base.id);
      if (count > 0) {
        bodies.set(host.id, body);
        report.converted += count;
        action = "converted";
      } else if (!base.trashed && !hasLinked(current, base.id)) {
        // Faute de bloc, la vue liée prend la fin de la page. Jamais pour une
        // base en corbeille : la page vivante montrerait une base jetée.
        bodies.set(host.id, [...current, linkedBlockFor(base.id)]);
        report.added++;
        action = "added";
      }
    }
    if (base.trashed) report.trashed++;
    else report.moved++;
    moved.push({ id: base.id, title: base.title ?? "", trashed: base.trashed, hostId: host?.id ?? null, action });
  }

  return { target, moved, bodies, report };
}
