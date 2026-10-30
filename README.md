# notion_perso

Application web personnelle façon Notion, mono-utilisateur et auto-hébergée : pages imbriquées, bases de données dont chaque entrée est une page, vide-cerveau, partage en lecture seule, import depuis Notion.

Stack : Next.js 16 (App Router, TypeScript), Drizzle, PostgreSQL, BlockNote.

## Lancer en local

Prérequis : Node 22, PostgreSQL local (Postgres.app).

```bash
createdb notion_perso_dev
cp .env.example .env   # ajuster DATABASE_URL si besoin
npm install
npm run db:check       # vérifie la connexion à la base
npm run db:migrate     # crée le schéma
npm run db:seed        # crée le compte unique (INITIAL_USERNAME, INITIAL_PASSWORD)
npm run dev            # http://localhost:3000
```

## Déploiement (Coolify)

Le VPS Hostinger exécute Coolify. Deux ressources dans un même projet :

1. **Base PostgreSQL 18** créée dans Coolify (healthcheck réglé à 60 s par
   l'API). Son adresse interne sert de `DATABASE_URL`.
2. **Application** depuis le dépôt GitHub, pack « Dockerfile », port 3000,
   domaine `https://notion.antoninbareau.eu`, stockage persistant monté sur
   `/data/uploads` (les médias), healthcheck sur `/login` toutes les 60 s.

Variables de l'application :

| Nom | Rôle |
|---|---|
| `DATABASE_URL` | adresse interne de la base Coolify |
| `INITIAL_USERNAME` | identifiant du compte unique |
| `INITIAL_PASSWORD` | mot de passe du compte unique |
| `SITE_NAME` | nom affiché dans la vue publique (défaut : `notion_perso`) |
| `LINKEDIN_URL` | adresse LinkedIn du pied de page (facultative) |
| `NODE_OPTIONS` | facultative, `--max-old-space-size=1024` pour un gros import |

Au démarrage, le serveur applique les migrations puis crée le compte s'il n'en
existe aucun (`src/db/bootstrap.ts`, activé par `MIGRATE_ON_START=1` dans le
`Dockerfile`). Les deux opérations sont idempotentes ; un échec arrête le
conteneur avec un message dans les logs. `UPLOAD_DIR` vaut `/data/uploads`
dans l'image.

Le domaine pointe vers le VPS par un enregistrement `A` (`notion`, zone
`antoninbareau.eu`) ; Coolify obtient le certificat HTTPS.

Essai local de l'image, avant un déploiement (Docker Desktop) :

```bash
docker build -t notion_perso:essai .
```

L'import Notion garde en mémoire le zip, l'archive décompressée et les médias.
Sur un VPS à 4 Go, un export complet peut manquer de mémoire : préférer
plusieurs exports par branches, ou relever temporairement `NODE_OPTIONS`.
