import type { DatabaseTarget } from "@/types/dba";

/**
 * Randomly picks an eligible database with priority PROD > NON-PROD.
 * Strictly selects only databases where enable_access !== false (i.e. enable_access = 'Y' / true).
 * Excludes decommissioned and inactive databases.
 *
 * @param databases - The array of database targets (e.g. from /api/databases?selector=1)
 * @returns The name of the selected database, or "" if no eligible database is found.
 */
export function pickRandomEligibleDb(databases: DatabaseTarget[]): string {
  if (!Array.isArray(databases) || databases.length === 0) {
    return "";
  }

  // 1. Deduplicate by logical database name
  const seen = new Set<string>();
  const uniqueDbs: DatabaseTarget[] = [];
  for (const db of databases) {
    const name = (db.name || "").trim().toUpperCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    uniqueDbs.push(db);
  }

  // 2. Filter only databases where enable_access !== false and status is active
  const eligible = uniqueDbs.filter((db) => {
    const isAccessEnabled = db.enable_access !== false;
    const status = (db.status || "").trim().toLowerCase();
    const isNotInactive =
      status !== "decommissioned" && status !== "decomissioned" && status !== "inactive";
    return isAccessEnabled && isNotInactive;
  });

  if (eligible.length === 0) {
    return "";
  }

  // 3. Partition into PROD and NON-PROD pools
  const prodDbs = eligible.filter((db) => {
    const envLabel = (db.env_label || "").trim().toUpperCase();
    const env = (db.environment || "").trim().toLowerCase();
    return envLabel === "PROD" || env === "production";
  });

  const nonProdDbs = eligible.filter((db) => {
    const envLabel = (db.env_label || "").trim().toUpperCase();
    const env = (db.environment || "").trim().toLowerCase();
    return envLabel !== "PROD" && env !== "production";
  });

  // 4. Selection Priority: PROD > NON-PROD
  if (prodDbs.length > 0) {
    const randomIndex = Math.floor(Math.random() * prodDbs.length);
    return prodDbs[randomIndex].name;
  }

  if (nonProdDbs.length > 0) {
    const randomIndex = Math.floor(Math.random() * nonProdDbs.length);
    return nonProdDbs[randomIndex].name;
  }

  return "";
}
