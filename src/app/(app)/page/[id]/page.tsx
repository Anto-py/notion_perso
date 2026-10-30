import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageView } from "@/components/PageView";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getPage } from "@/lib/pages";

// Page normale. Les entrées de base passeront aussi par ici à l'étape 3, avec
// leur panneau de propriétés.
export default function PageRoute({ params }: PageProps<"/page/[id]">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <PageLoader params={params} />
    </Suspense>
  );
}

async function PageLoader({ params }: Pick<PageProps<"/page/[id]">, "params">) {
  const { id } = await params;
  const user = await getCurrentUser();
  const page = await getPage(id);
  if (!page || page.trashedAt || page.type !== "page" || !canAccess(user, page, "read")) notFound();
  // key : changer de page recrée l'éditeur au lieu de recycler le précédent.
  return <PageView key={page.id} page={{ id: page.id, title: page.title, body: page.body as unknown[] }} />;
}
