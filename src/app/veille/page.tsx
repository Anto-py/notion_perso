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
import { SEARCH_MIN_LENGTH } from "@/lib/search";
import { parseVitrineState, vitrineRenderOptions, vitrineView, type VitrineState } from "@/lib/vitrine";
import { loadVitrine, searchVitrine, type Vitrine } from "@/lib/vitrine_query";

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
  const state = vitrine ? parseVitrineState(params, vitrine.entries) : null;
  // Une recherche dans l'adresse est jouée au serveur : un lien partagé
  // s'ouvre sur ses résultats, sans clignotement.
  const search = state && state.q.trim().length >= SEARCH_MIN_LENGTH ? await searchVitrine(state.q) : null;
  return (
    <div className="public">
      <main className="public-main">
        {vitrine && state ? (
          <VitrineContent vitrine={vitrine} state={state} ranked={search ? search.results.map((result) => result.slug) : null} />
        ) : (
          <p className="public-gone">Ce contenu n&apos;est plus disponible.</p>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

function VitrineContent({ vitrine, state, ranked }: { vitrine: Vitrine; state: VitrineState; ranked: string[] | null }) {
  const { base, entries, welcome } = vitrine;
  // ranked null (pas de recherche) : les résultats suivent les filtres seuls,
  // dans l'ordre du titre.
  const view = vitrineView(entries, state, ranked);
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
