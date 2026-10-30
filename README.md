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
npm run dev            # http://localhost:3000
```
