import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShareCapture } from "@/components/ShareCapture";
import { canAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { ensureInbox } from "@/lib/inbox";
import { listDatabases } from "@/lib/pages";
import { loginPath, sharedPayload } from "@/lib/share";

// Cible du partage natif (share_target en GET, app/manifest.ts). Hors du
// groupe (app) : un écran sans sidebar, fait pour le téléphone. En GET, le
// partage tient tout entier dans l'adresse, qui survit à une reconnexion.
export default function ShareRoute({ searchParams }: PageProps<"/share">) {
  return (
    <main className="share">
      <h1 className="share-heading">Capturer</h1>
      <Suspense fallback={<p className="page-loading">Chargement…</p>}>
        <ShareLoader searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const SHARE_FIELDS = ["title", "text", "url"] as const;

async function ShareLoader({ searchParams }: Pick<PageProps<"/share">, "searchParams">) {
  const params = await searchParams;
  const shared: Record<string, string> = {};
  for (const key of SHARE_FIELDS) {
    const value = params[key];
    if (typeof value === "string") shared[key] = value;
  }

  // Le proxy n'a vu qu'un cookie : une session expirée en base se découvre
  // ici, et la connexion ramène au même partage.
  const user = await getSessionUser();
  if (!user) redirect(loginPath(`/share?${new URLSearchParams(shared)}`));

  const payload = sharedPayload(shared);
  if (payload.kind === "empty") {
    return (
      <p className="share-empty">
        Ce partage ne contient ni lien ni texte. <Link href="/inbox">Aller au Vide-cerveau</Link>
      </p>
    );
  }

  const inbox = await ensureInbox();
  const databases = (await listDatabases()).filter((database) => database.id !== inbox.id && canAccess(user, database, "read"));
  return <ShareCapture payload={payload} inbox={{ id: inbox.id, title: inbox.title }} databases={databases} />;
}
