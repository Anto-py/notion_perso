// Partage natif vers une base ordinaire : le Vide-cerveau étant une page, il
// n'y a plus d'entrée à déplacer. La route crée l'entrée directement dans la
// base choisie, reporte les valeurs de même nom et de même type (les trois
// propriétés de l'ancien Vide-cerveau), écrit les autres au corps et garde
// l'image Open Graph en bandeau.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { appendOrphans } from "./blocks";
import { CAPTURE_TITLE_MAX, noteBlock } from "./capture";
import { COVER_POSITION_DEFAULT, imageCover } from "./covers";
import { createEntry } from "./databases";
import { newId } from "./ids";
import { recordMedia, updatePage } from "./pages";
import {
  orphanValues,
  transferValues,
  type Property,
  type Values,
} from "./properties";
import { saveFile } from "./storage";
import { domainOf } from "./unfurl";
import { fetchRemoteImage } from "./unfurl_fetch";
import { parseConfig } from "./views";

// Les propriétés de l'ancien Vide-cerveau : une base qui porte le même nom et
// le même type reçoit la valeur, les autres la retrouvent dans le corps.
const SHARED_PROPERTIES: readonly Property[] = [
  { id: "url", name: "URL", type: "url" },
  { id: "preview", name: "Aperçu", type: "text" },
  { id: "source", name: "Source", type: "text" },
];

export type SharedCapture = {
  url?: string;
  title?: string;
  description?: string;
  source?: string;
  image?: string | null;
  text?: string;
};

type Saved = { ok: true; id: string } | { ok: false; status: 400 | 404 | 409; error: string };

export async function captureIntoDatabase(dbId: string, shared: SharedCapture): Promise<Saved> {
  const [target] = await db
    .select({ type: pages.type, dbConfig: pages.dbConfig })
    .from(pages)
    .where(and(eq(pages.id, dbId), isNull(pages.trashedAt)));
  if (!target || target.type !== "database") return { ok: false, status: 404, error: "Base de destination introuvable" };
  const properties = parseConfig(target.dbConfig).properties;

  if (shared.url) {
    const values: Values = { url: shared.url };
    if (shared.description) values.preview = shared.description.slice(0, 5000);
    if (shared.source) values.source = shared.source.slice(0, 100);
    const transferred = transferValues(SHARED_PROPERTIES, properties, values);
    const orphans = orphanValues(SHARED_PROPERTIES, properties, values, transferred);
    const title = (shared.title?.trim() || domainOf(shared.url)).slice(0, CAPTURE_TITLE_MAX);
    const created = await createEntry(dbId, transferred, title);
    if (!created.ok) return created;
    if (!created.id) return { ok: false, status: 404, error: "Entrée introuvable après création" };
    if (orphans.length) {
      const body = appendOrphans([], orphans);
      const saved = await updatePage(created.id, { body });
      if (!saved.ok) return saved;
    }
    if (shared.image) await attachCover(created.id, shared.image);
    return { ok: true, id: created.id };
  }

  const text = (shared.text ?? "").trim();
  if (!text) return { ok: false, status: 400, error: "Rien à capturer" };
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const created = await createEntry(dbId, {}, (first || "Note").slice(0, CAPTURE_TITLE_MAX));
  if (!created.ok) return created;
  if (!created.id) return { ok: false, status: 404, error: "Entrée introuvable après création" };
  const body = [noteBlock(text)];
  const saved = await updatePage(created.id, { body });
  if (!saved.ok) return saved;
  return { ok: true, id: created.id };
}

// Même geste que l'ancienne capture de lien : l'image est téléchargée par le
// serveur, écrite sous `up_…` et posée en bandeau. Un échec la laisse absente.
async function attachCover(pageId: string, imageUrl: string): Promise<void> {
  const remote = await fetchRemoteImage(imageUrl);
  if (!remote) return;
  const mediaId = newId("up");
  const filename = `${mediaId}.${remote.ext}`;
  try {
    await saveFile(new Blob([remote.bytes]).stream(), filename);
  } catch {
    return;
  }
  await recordMedia({
    id: mediaId,
    filename,
    originalName: filename,
    mime: remote.mime,
    size: remote.bytes.byteLength,
    pageId,
  });
  await updatePage(pageId, { cover: imageCover(filename), coverPosition: COVER_POSITION_DEFAULT });
}
