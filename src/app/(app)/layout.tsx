import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";

// Zone protégée. La sidebar arrive à l'étape 2 ; pour l'instant, l'en-tête
// porte l'utilisateur et la déconnexion.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="app-header">
        <Suspense fallback={null}>
          <CurrentUser />
        </Suspense>
      </header>
      {children}
    </>
  );
}

// La session est lue ici, sous Suspense, et non au sommet du layout : un await
// à ce niveau retiendrait toute la page derrière la requête. Une session
// invalide redirige vers /login depuis ce composant.
async function CurrentUser() {
  const user = await getCurrentUser();
  return (
    <form method="post" action="/api/auth/logout">
      <span>{user.username}</span> <button type="submit">Se déconnecter</button>
    </form>
  );
}
