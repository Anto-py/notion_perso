// Vitrine de veille publique (BRAINSTORMING de la vitrine, §1) : la base
// activée dans « Partager », lue en direct à chaque visite. L'état de
// l'adresse (filtres, coups de cœur) est appliqué dès le rendu serveur :
// rangées et grille se lisent sans JavaScript, un lien partagé s'ouvre sans
// clignotement. Jamais indexée (robots ici, X-Robots-Tag dans next.config).
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageCover } from "@/components/PageCover";
import { PageIcon } from "@/components/PageIcon";
import { PublicFooter, siteName } from "@/components/PublicRenderer";
import { VitrineGrid } from "@/components/vitrine/VitrineGrid";
import { VitrineRow } from "@/components/vitrine/VitrineRow";
import { VitrineWelcome } from "@/components/vitrine/VitrineWelcome";
import { renderHtml } from "@/lib/blocks";
import { faviconHref } from "@/lib/icons";
import { parseVitrineState, vitrineRenderOptions, vitrineView } from "@/lib/vitrine";
import { loadVitrine, type Vitrine } from "@/lib/vitrine_query";

type SearchParams = PageProps<"/veille">["searchParams"];

const ROBOTS = { index: false, follow: false };

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const [vitrine, site] = await Promise.all([loadVitrine(), siteName()]);
  if (!vitrine) return { title: `Contenu indisponible · ${site}`, robots: ROBOTS };
  return {
    title: `${vitrine.base.title || "Sans titre"} · ${site}`,
    icons: { icon: faviconHref(vitrine.base.icon, "database") },
    robots: ROBOTS,
  };
}

export default function VeillePage({ searchParams }: PageProps<"/veille">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <VitrinePage searchParams={searchParams} />
    </Suspense>
  );
}

async function VitrinePage({ searchParams }: { searchParams: SearchParams }) {
  // Rendu à chaque requête, jamais au build : la vitrine suit la base.
  await connection();
  const [vitrine, params] = await Promise.all([loadVitrine(), searchParams]);
  return (
    <div className="public">
      <main className="public-main">
        {vitrine ? <VitrineContent vitrine={vitrine} params={params} /> : <p className="public-gone">Ce contenu n&apos;est plus disponible.</p>}
      </main>
      <PublicFooter />
    </div>
  );
}

function VitrineContent({ vitrine, params }: { vitrine: Vitrine; params: Awaited<SearchParams> }) {
  const { base, entries, welcome } = vitrine;
  const state = parseVitrineState(params, entries);
  // La recherche du serveur (searchVitrine) n'existe pas encore : sans elle,
  // les résultats ne suivent que les filtres, dans l'ordre du titre.
  const view = vitrineView(entries, state, null);
  const welcomeHtml = welcome ? renderHtml(welcome.body, vitrineRenderOptions(entries)).trim() : "";
  return (
    <>
      <PageCover cover={base.cover} position={base.coverPosition} className="page-cover public-cover" />
      <h1 className="vitrine-title">
        <PageIcon icon={base.icon} type="database" /> {base.title || "Sans titre"}
      </h1>
      {welcomeHtml ? <VitrineWelcome html={welcomeHtml} /> : null}
      {view.kind === "empty" ? <p className="vitrine-empty">La veille est en cours de constitution.</p> : null}
      {view.kind === "vitrine" ? (
        <>
          {view.heart.length ? <VitrineRow id="coeur" title="★ Coups de cœur" entries={view.heart} /> : null}
          <VitrineRow id="recent" title="✦ Ajoutés récemment" entries={view.recent} />
          <VitrineGrid entries={view.all} />
        </>
      ) : null}
      {view.kind === "results" ? (
        <VitrineRow id="results" title={`Résultats (${view.results.length})`} entries={view.results} empty="Aucune ressource ne correspond." />
      ) : null}
    </>
  );
}
