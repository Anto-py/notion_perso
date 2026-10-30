import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
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
  const rows = (await listTreeRows()).filter((row) => canAccess(user, row, "read"));
  return <Sidebar rows={rows} username={user.username} />;
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
