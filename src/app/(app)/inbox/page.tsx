import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InboxView } from "@/components/InboxView";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { countInbox, ensureInbox } from "@/lib/inbox";

// Vide-cerveau : la page est créée à la première visite. La lecture de session
// pose la connexion avant toute écriture, le rendu n'est pas pré-rendu.
export default function InboxRoute() {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <InboxLoader />
    </Suspense>
  );
}

async function InboxLoader() {
  const user = await getCurrentUser();
  const inbox = await ensureInbox();
  if (!canAccess(user, inbox, "read")) notFound();
  const count = await countInbox();
  return <InboxView inbox={{ id: inbox.id, title: inbox.title }} count={count} />;
}
