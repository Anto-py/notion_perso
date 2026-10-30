import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageView, type EntryContext } from "@/components/PageView";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { configOf } from "@/lib/databases";
import { getPage } from "@/lib/pages";
import { normalizeValues } from "@/lib/properties";

// Page normale ou entrée de base ; une entrée affiche en plus ses propriétés.
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
  if (!page || page.trashedAt || !canAccess(user, page, "read")) notFound();
  if (page.type === "database") redirect(`/db/${page.id}`);

  let entry: EntryContext | undefined;
  if (page.type === "entry") {
    const base = page.dbId ? await getPage(page.dbId) : null;
    if (!base || base.trashedAt || !canAccess(user, base, "read")) notFound();
    const { properties } = configOf(base);
    entry = {
      database: { id: base.id, title: base.title, icon: base.icon },
      properties,
      values: normalizeValues(properties, page.propertyValues),
    };
  }
  // key : changer de page recrée l'éditeur au lieu de recycler le précédent.
  return <PageView key={page.id} page={{ id: page.id, title: page.title, body: page.body as unknown[] }} entry={entry} />;
}
