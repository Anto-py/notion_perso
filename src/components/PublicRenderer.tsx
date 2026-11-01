// Vue publique d'une page, d'une base ou d'une entrée (BRAINSTORMING §7) :
// lecture seule, sans sidebar, en-tête au nom du site et pied de page signé.
// Le rendu du contenu vit dans ReadOnlyPage.tsx, partagé avec l'écran de
// sauvegarde, qui lui donne seulement une autre source de données.
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { safeHref } from "@/lib/blocks";
import { linksForValues, listEntries } from "@/lib/databases";
import { faviconHref } from "@/lib/icons";
import { fillTwins } from "@/lib/relation_query";
import { getPage } from "@/lib/pages";
import { publicHref } from "@/lib/publication";
import { listChildren, resolvePublication, type Publication } from "@/lib/publication_query";
import { getSetting } from "@/lib/settings";
import { ReadOnlyPage } from "./ReadOnlyPage";

export type PublicParams = Promise<{ publicId: string; pageId?: string }>;

// generateMetadata et la page lisent la même publication : une seule requête.
const resolve = cache(resolvePublication);

// Réglables sans toucher au code : Réglages › Vue publique d'abord, puis les
// variables SITE_NAME et LINKEDIN_URL en repli. Lus au rendu, jamais au
// build : ce composant est toujours rendu à la demande (il lit la base).
// cache() : métadonnées et page lisent le même réglage, une seule requête.
const siteName = cache(async (): Promise<string> => {
  return (await getSetting("public.site_name")) ?? (process.env.SITE_NAME?.trim() || "notion_perso");
});

async function linkedinUrl(): Promise<string | null> {
  const stored = await getSetting("public.linkedin_url");
  if (stored) return stored;
  const href = safeHref(process.env.LINKEDIN_URL ?? "");
  return href && href.startsWith("https://") ? href : null;
}

export async function publicMetadata(params: PublicParams): Promise<Metadata> {
  const { publicId, pageId } = await params;
  const found = await resolve(publicId, pageId);
  if (!found) return { title: `Contenu indisponible · ${await siteName()}`, robots: { index: false } };
  return {
    title: `${found.page.title || "Sans titre"} · ${await siteName()}`,
    icons: { icon: faviconHref(found.page.icon, found.page.type) },
  };
}

export async function PublicPage({ params }: { params: PublicParams }) {
  const { publicId, pageId } = await params;
  const [found, site] = await Promise.all([resolve(publicId, pageId), siteName()]);
  return (
    <div className="public">
      <header className="public-header">
        {found ? (
          <Link href={`/p/${publicId}`} className="public-site">
            {site}
          </Link>
        ) : (
          <span className="public-site">{site}</span>
        )}
      </header>
      <main className="public-main">
        {found ? <PublicContent publicId={publicId} found={found} /> : <p className="public-gone">Ce contenu n&apos;est plus disponible.</p>}
      </main>
      <PublicFooter />
    </div>
  );
}

async function PublicContent({ publicId, found }: { publicId: string; found: Publication }) {
  const { root, page, chain } = found;
  const children = page.type === "page" ? await listChildren(page.id) : [];
  return (
    <ReadOnlyPage
      page={page}
      crumbs={chain.slice(0, -1)}
      subpages={children}
      href={(id) => publicHref(publicId, root.id, id)}
      source={{
        getPage,
        listEntries,
        links: linksForValues,
        twinValues: async (properties, entry) => (await fillTwins(properties, [entry]))[0],
      }}
    />
  );
}

async function PublicFooter() {
  const linkedin = await linkedinUrl();
  return (
    <footer className="public-footer">
      <span className="public-ornament" aria-hidden="true">
        ❧
      </span>
      <p>
        Made by{" "}
        {linkedin ? (
          <a href={linkedin} target="_blank" rel="noopener noreferrer">
            Antonin Bareau
          </a>
        ) : (
          "Antonin Bareau"
        )}{" "}
        avec l&apos;aide essentielle d&apos;un ou plusieurs LLM
      </p>
    </footer>
  );
}
