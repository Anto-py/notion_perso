// Connexion à la base d'une sauvegarde ouverte (palier d de l'étape 12) :
// une copie restaurée par lib/backups.ts, lue ici en lecture seule. La base
// vive n'est jamais touchée par ce module.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { backupDatabaseName } from "./backup_rules";

type BackupMemory = {
  pool: Pool | null;
  db: NodePgDatabase<typeof schema> | null;
  connectionString: string | null;
};

// Next charge ce module deux fois (routes et instrumentation) : une seule
// connexion, donc un seul pool à fermer avant de déposer la base.
const shared = globalThis as typeof globalThis & { __notionBackupDb?: BackupMemory };
const memory: BackupMemory = (shared.__notionBackupDb ??= { pool: null, db: null, connectionString: null });

// Le nom de la base de sauvegarde, dérivé de DATABASE_URL (backup_rules.ts).
export function backupDbName(): string | null {
  return backupDatabaseName(process.env.DATABASE_URL);
}

// Mêmes identifiants que la base vive, autre nom de base. Sert aussi à la base
// jetable de la restauration d'essai.
export function connectionStringFor(name: string | null): string | null {
  if (!name || !process.env.DATABASE_URL) return null;
  try {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${name}`;
    return url.toString();
  } catch {
    return null;
  }
}

export function backupConnectionString(): string | null {
  return connectionStringFor(backupDbName());
}

// Lecture seule posée par la connexion elle-même : une écriture tentée par
// erreur est refusée par PostgreSQL, pas seulement évitée par le code.
export function backupDb(): NodePgDatabase<typeof schema> | null {
  const connectionString = backupConnectionString();
  if (!connectionString) return null;
  if (memory.db && memory.connectionString === connectionString) return memory.db;
  void closeBackupDb();
  const pool = new Pool({
    connectionString,
    options: "-c default_transaction_read_only=on",
    max: 3,
  });
  memory.pool = pool;
  memory.db = drizzle(pool, { schema });
  memory.connectionString = connectionString;
  return memory.db;
}

// Avant de déposer la base : sans cela, dropdb refuse une connexion ouverte.
export async function closeBackupDb(): Promise<void> {
  const pool = memory.pool;
  memory.pool = null;
  memory.db = null;
  memory.connectionString = null;
  if (pool) await pool.end().catch(() => undefined);
}
