import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { SyncStatusProvider } from "@/components/SyncStatus";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { countInbox } from "@/lib/inbox";
import { listTreeRows } from "@/lib/pages";
import { lastClientSeen } from "@/lib/sync_clients";

// Zone protégée : sidebar à gauche, page ouverte au centre. Le fournisseur
// d'état de synchronisation enveloppe les deux : ligne de la barre latérale
// et indicateur de page lisent la même source.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="app-shell">
      <SyncStatusProvider>
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarData />
        </Suspense>
        <div className="app-main">{children}</div>
      </SyncStatusProvider>
    </div>
  );
}

// Session et arbre sont lus ici, sous Suspense : un await au sommet du layout
// retiendrait toute la page derrière la requête. Une session invalide
// redirige vers /login depuis ce composant.
async function SidebarData() {
  const user = await getCurrentUser();
  const [rows, inboxCount, macSyncedAt] = await Promise.all([listTreeRows(), countInbox(), lastClientSeen()]);
  return (
    <Sidebar
      rows={rows.filter((row) => canAccess(user, row, "read"))}
      username={user.username}
      inboxCount={inboxCount}
      macSyncedAt={macSyncedAt?.toISOString() ?? null}
    />
  );
}

function SidebarSkeleton() {
  return (
    <aside className="sidebar" aria-busy="true">
      <span className="sidebar-home">notion_perso</span>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton short" />
    </aside>
  );
}
