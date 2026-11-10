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
import { Vitrine } from "@/components/vitrine/Vitrine";
import { VitrineWelcome } from "@/components/vitrine/VitrineWelcome";
import { renderHtml } from "@/lib/blocks";
import { faviconHref } from "@/lib/icons";
import { SEARCH_MIN_LENGTH } from "@/lib/search";
import { parseVitrineState, vitrineRenderOptions, type VitrineState } from "@/lib/vitrine";
import { loadVitrine, searchVitrine, type Vitrine as VitrineData } from "@/lib/vitrine_query";
import type { VitrineSearch } from "@/lib/vitrine_search";

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
          <VitrineContent vitrine={vitrine} state={state} search={search} />
        ) : (
          <p className="public-gone">Ce contenu n&apos;est plus disponible.</p>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

function VitrineContent({ vitrine, state, search }: { vitrine: VitrineData; state: VitrineState; search: VitrineSearch | null }) {
  const { base, entries, welcome } = vitrine;
  const welcomeHtml = welcome ? renderHtml(welcome.body, vitrineRenderOptions(entries)).trim() : "";
  // Vitrine reçoit l'état et la recherche déjà jouée : son rendu serveur est
  // celui que l'hydratation retrouve.
  return (
    <>
      <PageCover cover={base.cover} position={base.coverPosition} className="page-cover public-cover" />
      <h1 className="vitrine-title">
        <PageIcon icon={base.icon} type="database" /> {base.title || "Sans titre"}
      </h1>
      {welcomeHtml ? <VitrineWelcome html={welcomeHtml} /> : null}
      <Vitrine entries={entries} initialState={state} initialSearch={search} />
    </>
  );
}
