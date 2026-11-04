import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { hydrateRemoteMedia, type RemoteFetcher } from "@/lib/import_remote";
import { buildImportPlan } from "@/lib/notion-import";

const ROOT_ID = "a".repeat(32);

function ids() {
  let next = 0;
  return {
    newId: (prefix: string) => `${prefix}_${String(next++).padStart(16, "0")}`,
    newBlockId: () => `blk_${next++}`,
  };
}

function archive(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) entries[path] = strToU8(content);
  return zipSync(entries);
}

const PAGE = (body: string, header = "") =>
  `<html><body><article><header>${header}</header><div class="page-body">${body}</div></article></body></html>`;

function fetcher(map: Record<string, boolean>): RemoteFetcher {
  return async (url) =>
    map[url] ? { bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png", ext: "png" } : null;
}

describe("hydrateRemoteMedia", () => {
  it("rapatrie le bandeau et les images de corps, compte les échecs", async () => {
    const plan = buildImportPlan(
      archive({
        [`Note ${ROOT_ID}.html`]: PAGE(
          `<figure class="image"><img src="https://cdn.exemple/ok.png"/></figure>
           <figure class="image"><img src="https://cdn.exemple/hors-ligne.png"/></figure>`,
          `<img class="page-cover-image" src="https://cdn.exemple/ok.png" style="object-position:center 20%"/>`,
        ),
      }),
      ids(),
    );
    expect(plan.remotes).toHaveLength(3);

    await hydrateRemoteMedia(
      plan,
      fetcher({ "https://cdn.exemple/ok.png": true, "https://cdn.exemple/hors-ligne.png": false }),
      ids(),
    );

    const page = plan.pages.find((item) => item.title === "Note")!;
    expect(page.cover).toMatch(/^image:up_[A-Za-z0-9_-]{16}\.png$/);
    // Le cadrage lu dans le HTML survit au rapatriement.
    expect(page.coverPosition).toBe(20);
    // L'image de corps partage le média du bandeau : une seule entrée pour
    // deux usages de la même adresse.
    expect(plan.media).toHaveLength(1);
    expect(page.body[0].props.url).toBe(`/api/media/${plan.media[0].storedName}`);
    expect(page.body[1].type).toBe("paragraph");
    expect(JSON.stringify(page.body[1].content)).toContain("hors-ligne.png");
    expect(plan.report.ignored).toContainEqual({ reason: "image distante injoignable", count: 1 });
    expect(plan.report.counts.media).toBe(1);
  });

  it("range une icône distante en bibliothèque et la pose sur la page", async () => {
    const plan = buildImportPlan(
      archive({
        [`Note ${ROOT_ID}.html`]: `<article><header><div class="page-header-icon undefined"><img class="icon" src="https://cdn.exemple/icone.png"/></div><h1 class="page-title">Note</h1></header><div class="page-body"></div></article>`,
      }),
      ids(),
    );
    await hydrateRemoteMedia(plan, fetcher({ "https://cdn.exemple/icone.png": true }), ids());
    const page = plan.pages.find((item) => item.title === "Note")!;
    expect(page.icon).toMatch(/^image:up_[A-Za-z0-9_-]{16}\.png$/);
    expect(plan.icons).toHaveLength(1);
    expect(plan.media[0].pageId).toBeNull();
  });

  it("dédoublonne une même adresse citée par deux pages", async () => {
    const plan = buildImportPlan(
      archive({
        [`A ${ROOT_ID}.html`]: PAGE(`<figure class="image"><img src="https://cdn.exemple/partagee.png"/></figure>`),
        [`B ${"b".repeat(32)}.html`]: PAGE(`<figure class="image"><img src="https://cdn.exemple/partagee.png"/></figure>`),
      }),
      ids(),
    );
    await hydrateRemoteMedia(plan, fetcher({ "https://cdn.exemple/partagee.png": true }), ids());
    expect(plan.media).toHaveLength(1);
  });
});
