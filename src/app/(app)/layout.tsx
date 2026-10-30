import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { countInbox } from "@/lib/inbox";
import { listTreeRows } from "@/lib/pages";

// Zone protégée : sidebar à gauche, page ouverte au centre.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="app-shell">
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarData />
      </Suspense>
      <div className="app-main">{children}</div>
    </div>
  );
}

// Session et arbre sont lus ici, sous Suspense : un await au sommet du layout
// retiendrait toute la page derrière la requête. Une session invalide
// redirige vers /login depuis ce composant.
async function SidebarData() {
  const user = await getCurrentUser();
  const [rows, inboxCount] = await Promise.all([listTreeRows(), countInbox()]);
  return <Sidebar rows={rows.filter((row) => canAccess(user, row, "read"))} username={user.username} inboxCount={inboxCount} />;
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
