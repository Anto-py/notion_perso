import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReadOnlyPage } from "@/components/ReadOnlyPage";
import { RecoverButton } from "@/components/backup/RecoverButton";
import { backupChildren, backupCrumbs, backupEntries, backupLinks, backupPage, backupSubtree, backupTwins } from "@/lib/backup_read";

// Une page de la sauvegarde ouverte, rendue par le même composant que la vue
// publique (palier d de l'étape 12). Les pages en corbeille du dump ne
// s'ouvrent pas : elles ne sont pas dans l'arbre non plus.
export async function generateMetadata({ params }: PageProps<"/sauvegarde/[id]">): Promise<Metadata> {
  const { id } = await params;
  const page = await backupPage(id);
  return { title: page ? `${page.title || "Sans titre"} · Sauvegarde` : "Sauvegarde" };
}

export default function BackupPageView({ params }: PageProps<"/sauvegarde/[id]">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <BackupPageData params={params} />
    </Suspense>
  );
}

async function BackupPageData({ params }: { params: PageProps<"/sauvegarde/[id]">["params"] }) {
  const { id } = await params;
  const page = await backupPage(id);
  if (!page || page.trashedAt) notFound();
  const [crumbs, children, subtree] = await Promise.all([
    backupCrumbs(id),
    page.type === "page" ? backupChildren(id) : Promise.resolve([]),
    backupSubtree(id),
  ]);
  return (
    <div className="public backup-read">
      <RecoverButton id={page.id} kind={page.type} descendants={Math.max(0, subtree.length - 1)} />
      <ReadOnlyPage
        page={page}
        crumbs={crumbs}
        subpages={children}
        href={(pageId) => `/sauvegarde/${pageId}`}
        source={{ getPage: backupPage, listEntries: backupEntries, links: backupLinks, twinValues: backupTwins }}
        mediaBase="/api/sauvegarde/media/"
        linkedPolicy="all"
      />
    </div>
  );
}
