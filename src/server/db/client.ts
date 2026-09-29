import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle (same query API as Database). */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const globalForDb = globalThis as unknown as { __naPool?: Pool; __naDb?: Database };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000),
    // Fail fast instead of piling up locks under contention.
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 30_000,
  });
}

export function getPool(): Pool {
  if (!globalForDb.__naPool) globalForDb.__naPool = createPool();
  return globalForDb.__naPool;
}

export function getDb(): Database {
  if (!globalForDb.__naDb) globalForDb.__naDb = drizzle(getPool(), { schema });
  return globalForDb.__naDb;
}

/** Tests: tear down the shared pool. */
export async function closeDb() {
  await globalForDb.__naPool?.end();
  globalForDb.__naPool = undefined;
  globalForDb.__naDb = undefined;
}

export { schema };
