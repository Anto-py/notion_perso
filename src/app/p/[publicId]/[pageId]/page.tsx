import { Suspense } from "react";
import { PublicPage, publicMetadata } from "@/components/PublicRenderer";

// Sous-page, base ou entrée d'une publication : servie seulement si elle
// descend de la page publiée (lib/publication.ts).
export function generateMetadata({ params }: PageProps<"/p/[publicId]/[pageId]">) {
  return publicMetadata(params);
}

export default function PublicDescendant({ params }: PageProps<"/p/[publicId]/[pageId]">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <PublicPage params={params} />
    </Suspense>
  );
}
