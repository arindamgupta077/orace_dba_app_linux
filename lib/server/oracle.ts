import "server-only";

import oracledb, { type Connection } from "oracledb";

import { getServerEnv } from "@/lib/server/env";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;
oracledb.fetchAsString = [oracledb.CLOB];

// A named alias lets us survive Next.js hot-reloads in dev mode.  When the
// module is re-evaluated, oracledb (a native external) keeps its existing
// pools alive, so we can look up the pool by alias instead of creating a
// duplicate.
const POOL_ALIAS = "dba_portal";

let poolPromise: Promise<oracledb.Pool> | null = null;

async function getPool(): Promise<oracledb.Pool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      // After a hot-reload the native oracledb module retains the old pool.
      // Re-use it rather than opening a duplicate.
      try {
        return oracledb.getPool(POOL_ALIAS);
      } catch {
        // Pool doesn't exist yet — create it.
      }

      const env = getServerEnv();
      return oracledb.createPool({
        poolAlias: POOL_ALIAS,
        user: env.oracleUser,
        password: env.oraclePassword,
        connectString: env.oracleConnectString,
        poolMin: 2,         // keep 2 connections warm at all times
        poolMax: 10,        // allow more concurrency under polling load
        poolIncrement: 1,
        poolTimeout: 300,   // 5-minute idle timeout (was 60 s)
        stmtCacheSize: 30
      });
    })();
  }

  return poolPromise;
}

/**
 * Called by instrumentation.ts at server startup to establish the minimum
 * pool connections before the first HTTP request arrives, so users never
 * experience the 10 s Oracle TCP-handshake delay on their first page load.
 */
export async function preWarmPool(): Promise<void> {
  await getPool();
}

export async function withOracleConnection<T>(fn: (connection: Connection) => Promise<T>) {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
}

