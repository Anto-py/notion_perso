// Rapatriement des images distantes d'un plan d'import (bandeau, image de
// corps, icône) : le plan reste pur, le réseau et le disque viennent après.
// Une image injoignable est comptée au rapport ; un bloc image qui la portait
// devient un lien, pour que la vue publique n'appelle jamais un tiers.
import { newId as defaultNewId } from "./ids";
import type { Block } from "./notion-markdown";
import type { ImportPlan, PlanIcon, PlanMedia, RemoteAsset } from "./notion-import";

export type RemoteImage = { bytes: Uint8Array; mime: string; ext: string };
export type RemoteFetcher = (url: string) => Promise<RemoteImage | null>;

export type RemoteOptions = {
  // Téléchargements simultanés : quatre par défaut, pour ne pas saturer un
  // petit VPS ni matraquer un hôte.
  concurrency?: number;
  newId?: (prefix: string) => string;
  onIgnored?: (reason: string) => void;
};

const DEFAULT_PROPS = { textColor: "default", textAlignment: "left", backgroundColor: "default" };

function note(plan: ImportPlan, reason: string, amount: number): void {
  const found = plan.report.ignored.find((item) => item.reason === reason);
  if (found) found.count += amount;
  else plan.report.ignored.push({ reason, count: amount });
}

function filenameOf(url: string): string {
  const path = url.split("?")[0].split("#")[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name).slice(0, 255) || "image";
  } catch {
    return name.slice(0, 255) || "image";
  }
}

function findBlock(blocks: Block[], blockId: string): Block | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const found = findBlock(block.children, blockId);
    if (found) return found;
  }
  return null;
}

// Remplace le bloc porteur d'une image par un paragraphe de lien : une image
// qu'on n'a pas pu rapatrier ne doit pas faire appeler le site d'origine.
function replaceBlock(blocks: Block[], blockId: string, url: string): boolean {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.id === blockId) {
      blocks[index] = {
        id: block.id,
        type: "paragraph",
        props: { ...DEFAULT_PROPS },
        content: [{ type: "link", href: url, content: [{ type: "text", text: url, styles: {} }] }],
        children: block.children,
      };
      return true;
    }
    if (replaceBlock(block.children, blockId, url)) return true;
  }
  return false;
}

export async function hydrateRemoteMedia(
  plan: ImportPlan,
  fetcher: RemoteFetcher,
  options: RemoteOptions = {},
): Promise<ImportPlan> {
  const makeId = options.newId ?? defaultNewId;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const pages = new Map(plan.pages.map((page) => [page.id, page]));
  // Une image de corps et un bandeau partagent un média ; une icône de
  // bibliothèque a le sien (pageId nul, entrée icon_images).
  const mediaByKey = new Map<string, PlanMedia>();
  // Même adresse demandée deux fois dans un même lot : une seule requête.
  const inflight = new Map<string, Promise<PlanMedia | null>>();
  let failed = 0;

  const keyOf = (asset: RemoteAsset) => (asset.kind === "icon" ? `icon:${asset.url}` : asset.url);

  function load(asset: RemoteAsset): Promise<PlanMedia | null> {
    const key = keyOf(asset);
    const known = mediaByKey.get(key);
    if (known) return Promise.resolve(known);
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      const image = await fetcher(asset.url).catch(() => null);
      if (!image) {
        failed++;
        return null;
      }
      const id = makeId("up");
      const media: PlanMedia = {
        id,
        storedName: `${id}.${image.ext}`,
        originalName: filenameOf(asset.url),
        mime: image.mime,
        size: image.bytes.length,
        bytes: image.bytes,
        pageId: asset.kind === "icon" ? null : asset.pageId,
      };
      plan.media.push(media);
      if (asset.kind === "icon") {
        const icon: PlanIcon = { id: makeId("ic"), mediaId: media.id, name: filenameOf(asset.url).slice(0, 100) };
        plan.icons.push(icon);
      }
      mediaByKey.set(key, media);
      return media;
    })();
    inflight.set(key, promise);
    return promise;
  }

  function apply(asset: RemoteAsset, page: (typeof plan.pages)[number], media: PlanMedia): void {
    if (asset.kind === "cover") {
      page.cover = `image:${media.storedName}`;
      return;
    }
    if (asset.kind === "icon") {
      page.icon = `image:${media.storedName}`;
      return;
    }
    if (!asset.blockId) return;
    const block = findBlock(page.body, asset.blockId);
    if (block) block.props[asset.prop ?? "url"] = `/api/media/${media.storedName}`;
  }

  async function handle(asset: RemoteAsset): Promise<void> {
    const page = pages.get(asset.pageId);
    if (!page) return;
    const media = await load(asset);
    if (media) {
      apply(asset, page, media);
      return;
    }
    if (asset.kind === "image" && asset.blockId && !asset.prop) {
      replaceBlock(page.body, asset.blockId, asset.url);
    }
  }

  for (let index = 0; index < plan.remotes.length; index += concurrency) {
    await Promise.all(plan.remotes.slice(index, index + concurrency).map(handle));
  }

  if (failed > 0) {
    note(plan, "image distante injoignable", failed);
    options.onIgnored?.("image distante injoignable");
  }
  plan.report.counts.media = plan.media.length;
  return plan;
}
