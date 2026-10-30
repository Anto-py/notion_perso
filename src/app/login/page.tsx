import { Suspense } from "react";

const MESSAGES: Record<string, string> = {
  identifiants: "Nom d'utilisateur ou mot de passe incorrect.",
  attente: "Trop de tentatives. Réessaie dans quelques minutes.",
};

// Le formulaire poste directement vers la route d'API : la connexion marche
// sans JavaScript.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="login">
      <h1>Connexion</h1>
      <form method="post" action="/api/auth/login">
        <label>
          Nom d&apos;utilisateur
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          Mot de passe
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <Suspense fallback={null}>
          <LoginError searchParams={searchParams} />
        </Suspense>
        <button type="submit">Se connecter</button>
      </form>
    </main>
  );
}

// Lire searchParams est une donnée de requête : sous Suspense, comme l'exige
// cacheComponents, pour que le reste du formulaire reste statique.
async function LoginError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { erreur } = await searchParams;
  const message = typeof erreur === "string" ? MESSAGES[erreur] : undefined;
  return message ? <p role="alert">{message}</p> : null;
}
