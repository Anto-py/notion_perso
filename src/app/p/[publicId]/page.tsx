import { Suspense } from "react";
import { PublicPage, publicMetadata } from "@/components/PublicRenderer";

// Racine d'une publication, lisible sans compte (proxy.ts laisse passer /p/*).
export function generateMetadata({ params }: PageProps<"/p/[publicId]">) {
  return publicMetadata(params);
}

export default function PublicRoot({ params }: PageProps<"/p/[publicId]">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <PublicPage params={params} />
    </Suspense>
  );
}
