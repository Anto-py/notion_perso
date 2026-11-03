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

## Sauvegardes

Trois étages, l'un sur le VPS, les deux autres sur le Mac, hors de chez
l'hébergeur.

1. **Coolify**, sur le VPS : dump de la base chaque nuit (`0 2 * * *` UTC,
   14 gardés) et archive du stockage `/data/uploads` chaque dimanche
   (2 gardées). Revenir à un jour donné sans restaurer toute la machine.
2. **Copie du serveur, par l'app Mac** (section suivante) : app ouverte, au
   démarrage puis toutes les 6 h, l'app recopie par SSH le dernier dump
   nocturne du VPS quand sa dernière copie a plus de 20 h
   (`src/lib/server_dump.ts`). Rien n'est écrit sur le VPS. La copie est
   restaurée dans une base jetable pour être relue, puis gardée dans
   `~/notion_perso_app/sauvegardes/` sous `serveur_AAAAMMJJ_HHMM.dmp`, datée du
   dump (7 gardées). Une copie illisible n'est pas gardée ; trois jours sans
   copie récente, la ligne d'état de l'app le signale.
3. **Base du Mac** : un dump de `notion_perso_local` au premier lancement du
   jour et avant chaque mise à jour (7 et 3 gardés).

Toutes ces sauvegardes du Mac s'ouvrent en lecture seule dans Réglages ›
Sauvegardes, où une page se récupère ; une restauration d'essai relit chaque
semaine la dernière du Mac et la dernière copie du serveur. Les médias n'ont
pas de copie à part : la synchronisation recopie ceux des pages, le Mac garde
30 jours en quarantaine ceux qu'elle efface, et l'archive hebdomadaire de
Coolify couvre le VPS.

L'application elle-même efface un média 30 jours après qu'il a cessé de
servir (aucune page, corbeille comprise, ne le cite, et il n'est pas une
image visible de la bibliothèque d'icônes). Une purge manuelle de la
corbeille (un élément, ou « Vider la corbeille ») efface aussitôt les médias
des pages purgées qui ne servent plus ailleurs.

## App Mac synchronisée

Une seconde instance tourne sur le Mac, contre sa propre base
(`notion_perso_local`), utilisable sans réseau et synchronisée avec le serveur.
Elle se prépare une fois :

1. Créer un client de synchronisation sur le serveur
   (`DATABASE_URL=… npm run sync:jeton -- "Mac"`) et ranger le jeton au
   trousseau : `security add-generic-password -s notion-perso-sync -a mac -w`.
2. Écrire `~/notion_perso_app/app.conf` :
   ```bash
   NOTION_APP_DISTANT=https://<app web>
   NOTION_APP_COOLIFY=https://<instance Coolify>/api/v1
   NOTION_APP_COOLIFY_APP=<uuid de l'application Coolify>
   ```
   Facultatifs, pour la copie du dump nocturne du serveur :
   ```bash
   NOTION_APP_VPS_HOTE=root@<adresse du VPS>
   NOTION_APP_VPS_CLE=$HOME/.ssh/<clé sans phrase de passe>
   NOTION_APP_VPS_DUMPS=/data/coolify/backups/databases/<équipe>/<base>
   ```
   Le jeton de l'API Coolify est lu au trousseau (service `coolify-api`).
3. Lancer une première fois dans un terminal, qui demande le compte local :
   `bash scripts/notion_lancer.sh`.
4. Fabriquer l'app : `bash scripts/notion_app.sh` (dans `/Applications`).

À chaque ouverture, l'app se cale sur le dernier déploiement Coolify réussi,
le construit si besoin (la version précédente reste en secours), migre la base
locale, lance le serveur sur `127.0.0.1:3200` et ouvre une fenêtre Chrome à
profil dédié. Fermer cette fenêtre, ou Cmd + Q, arrête tout. Sans réseau, la
version déjà construite sert. Journal : `~/notion_perso_app/journal/lancer.log`.

## Licence

MIT, voir [LICENSE](LICENSE). BlockNote, l'éditeur, est sous MPL-2.0.
