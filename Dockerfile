# syntax=docker/dockerfile:1
# Image de notion_perso pour Coolify (application Dockerfile, base PostgreSQL
# gérée à part par Coolify). Deux étapes : builder (build Next) puis runner
# (l'application seule, sans outil de développement). Au démarrage, le serveur
# applique les migrations et crée le compte unique (src/instrumentation.ts).
#
# Le développement local ne passe pas par Docker (Postgres.app, npm run dev) :
# ce fichier ne sert qu'au VPS.
FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
# Le VPS a 4 Go de RAM et 1 vCPU : le build a besoin de place, sans prendre
# toute la machine.
ENV NODE_OPTIONS=--max-old-space-size=1536
# Le module de base lève une erreur si DATABASE_URL manque dès l'import. Le
# build ne se connecte pas : une valeur factice suffit, la vraie vient du
# compose au démarrage.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Migrations et compte unique au démarrage, médias sur le volume persistant
# que Coolify monte sur /data/uploads.
ENV MIGRATE_ON_START=1
ENV UPLOAD_DIR=/data/uploads
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# server.js n'embarque ni public ni .next/static : on les copie à côté.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Lu par le migrateur de drizzle-orm au démarrage (src/db/bootstrap.ts).
COPY --from=builder /app/src/db/migrations ./src/db/migrations
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
