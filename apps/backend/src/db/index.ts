import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { PoolConfig } from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Returns a shared Drizzle instance backed by a pg Pool.
 *
 * The pool reads DATABASE_URL from the environment once and reuses
 * connections for the lifetime of the process.
 */
export function getDb() {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // Force IPv4 — pg prefers IPv6, which fails with ECONNREFUSED on networks
  // without an IPv6 route to the Supabase host (same fix as the migration
  // and seed scripts).
  const pool = new Pool({
    connectionString,
    family: 4,
    // Fail fast instead of queueing forever when Supabase's DB/pooler host
    // flaps (recurring DNS/connectivity issue) — a silent indefinite hang is
    // far worse than an explicit 500. 5s connect + 8s per query.
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    idleTimeoutMillis: 10_000,
  } as PoolConfig);

  // Honor APP_TIMEZONE for per-connection sessions so SQL-level now()/reads
  // report local time. Physical storage remains UTC (timestamptz is correct).
  const tz = process.env.APP_TIMEZONE?.trim();
  if (tz) {
    pool.on("connect", (client) => {
      client.query(`SET TIME ZONE '${tz.replace(/'/g, "''")}'`).catch(() => {
        /* non-fatal: keep UTC session */
      });
    });
  }

  _db = drizzle(pool, { schema });
  return _db;
}

export { schema };

/** Drizzle database type — use for optional db parameters in auth functions. */
export type AppDb = ReturnType<typeof drizzle<typeof schema>>;
