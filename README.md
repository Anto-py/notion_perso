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

Deux étages, l'un sur le VPS, l'autre hors de chez l'hébergeur.

1. **Coolify**, sur le VPS : dump de la base chaque nuit (`0 2 * * *` UTC,
   14 gardés) et archive du stockage `/data/uploads` chaque dimanche
   (2 gardées). Revenir à un jour donné sans restaurer toute la machine.
2. **Miroir sur un Mac** : `scripts/miroir.sh` copie par SSH le dernier dump
   et les médias (`rsync`, sans `--delete`), vérifie le dump puis le restaure
   dans une base locale `notion_perso_miroir`, substituée à l'ancienne
   seulement si la restauration réussit. Un média absent du VPS **et** de la
   base restaurée est effacé du Mac 14 jours plus tard ; absent du VPS mais
   encore en base, il est gardé et signalé. Notification macOS en cas
   d'échec, de média manquant ou après trois jours sans copie réussie.

L'application elle-même efface un média 30 jours après qu'il a cessé de
servir (aucune page, corbeille comprise, ne le cite, et il n'est pas une
image visible de la bibliothèque d'icônes). Une purge manuelle de la
corbeille (un élément, ou « Vider la corbeille ») efface aussitôt les médias
des pages purgées qui ne servent plus ailleurs.

```bash
bash scripts/miroir.sh            # copie si la dernière a plus de 20 h
bash scripts/miroir.sh --force    # copie maintenant
```

Les réglages (hôte, clé SSH, chemins du dump et du volume) vivent dans
`~/notion_perso_miroir/miroir.conf`, hors dépôt ; l'en-tête du script en donne
la liste. Un LaunchAgent le lance à l'ouverture de session puis toutes les
6 h (`RunAtLoad`, `StartInterval` à 21600).

Pour consulter le miroir, le compte de production servant à la connexion :

```bash
bash scripts/miroir_consulter.sh   # http://127.0.0.1:3100, Ctrl + C pour arrêter
```

Le script construit l'application dans un second clone
(`~/notion_perso_miroir/app`), calé sur le plus récent déploiement Coolify
dont la dernière migration est celle du miroir, puis la lance avec un rôle
Postgres qui lit tout et n'écrit que ses sessions (`scripts/miroir_droits.sql`).
Purge de la corbeille et nettoyage des médias y échouent sans rien effacer.

Sans terminal : `bash scripts/miroir_app.sh /Applications` fabrique
« Miroir notion.app », à poser dans le Dock ou sur le bureau. L'ouvrir lance
le miroir et son onglet, cliquer à nouveau sur l'icône rouvre l'onglet,
la quitter (Cmd + Q) arrête le serveur. Échecs et construction s'annoncent
par notification, le détail va dans `~/notion_perso_miroir/journal/consulter.log`.

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
