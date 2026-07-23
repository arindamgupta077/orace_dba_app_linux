import "server-only";

export interface DestructiveSqlResult {
  destructive: boolean;
  /** Human-readable reasons (one per matched pattern) for the admin UI / audit log. */
  reasons: string[];
  /** The normalized SQL (comments + string literals stripped, whitespace
   *  collapsed) so the caller can compute a dedup signature from a stable
   *  representation. */
  normalizedSql: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Remove SQL comments and string literals so that keywords appearing inside
 * string constants (e.g. `SELECT 'DROP TABLE' AS msg FROM DUAL`) or comments
 * cannot trigger a false-positive match.
 *
 * Handles:
 *   -- single-line comments  (up to end of line)
 *   /* multi-line comments
 *   '...' string literals   (with '' as the Oracle escape)
 *   q'...' alternative quoting (q'[...]', q'{...}', etc.)
 */
function stripCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    // ── Line comment: -- ... \n ─────────────────────────────────────────
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < len && sql[i] !== "\n") i++;
      continue;
    }

    // ── Block comment: /* ... */  (handles nesting) ─────────────────────
    if (ch === "/" && next === "*") {
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else { i++; }
      }
      out += " ";
      continue;
    }

    // ── Alternative quoting: q'x...x'  (x = any single char, often [ ] { } ( ) < >) ──
    if ((ch === "q" || ch === "Q") && next === "'") {
      const delim = sql[i + 2];
      if (delim && delim !== "'") {
        // For bracket-style delimiters, Oracle uses pairs: [→], {→}, (→), <→>
        const closeDelim =
          delim === "[" ? "]" :
          delim === "{" ? "}" :
          delim === "(" ? ")" :
          delim === "<" ? ">" :
          delim;
        const start = i + 3;
        const end = sql.indexOf(closeDelim + "'", start);
        if (end !== -1) {
          out += " '' ";
          i = end + 2;
          continue;
        }
      }
    }

    // ── String literal: '...' (with '' as escape for a literal quote) ────
    if (ch === "'") {
      i++;
      while (i < len) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }  // escaped quote
          i++; break;
        }
        i++;
      }
      out += " '' ";
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Collapse whitespace to single spaces and uppercase. */
function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toUpperCase();
}

/** True when `normalized` contains `token` as a standalone word (bounded by
 *  non-alphanumeric characters), not as a substring of a longer identifier. */
function hasKeyword(normalized: string, token: string): boolean {
  const re = new RegExp(`(^|[^A-Z0-9_])${token}([^A-Z0-9_]|$)`, "i");
  return re.test(normalized);
}

/** Returns the first keyword from `tokens` found in `normalized`, or null. */
function firstMatchedKeyword(normalized: string, tokens: readonly string[]): string | null {
  for (const t of tokens) {
    if (hasKeyword(normalized, t)) return t;
  }
  return null;
}

// ── Destructive keyword groups ──────────────────────────────────────────

/** Top-level DDL/DML that is unconditionally destructive on PROD. */
const DESTRUCTIVE_KEYWORDS = [
  "DROP",
  "PURGE",
  "TRUNCATE",
  "DELETE",
  "UPDATE",
  "INSERT",
  "MERGE",
  "FLASHBACK TABLE",
  "FLASHBACK DATABASE",
  "RENAME"
] as const;

/** PL/SQL block starters — anonymous blocks can contain arbitrary
 *  destructive code, so we always flag them for review on PROD. */
const PLSQL_BLOCK_STARTERS = [
  "BEGIN",
  "DECLARE",
  "EXECUTE IMMEDIATE",
  "EXEC ",
  "CALL"
] as const;

/** ALTER TABLE sub-clauses that remove or permanently modify data/schema. */
const DESTRUCTIVE_ALTER_TABLE_PATTERNS: readonly string[] = [
  "DROP COLUMN",
  "DROP UNUSED COLUMNS",
  "DROP COLUMNS",
  "DROP PARTITION",
  "DROP SUBPARTITION",
  "TRUNCATE PARTITION",
  "TRUNCATE SUBPARTITION",
  "DROP CONSTRAINT",
  "DROP PRIMARY KEY",
  "DROP UNIQUE",
  "DROP CHECK",
  "MOVE TABLESPACE",
  "SHRINK SPACE",
  "SHRINK SPACE COMPACT",
  "CONVERT TO NCHAR"
];

/** ALTER DATABASE sub-clauses that remove or permanently affect components. */
const DESTRUCTIVE_ALTER_DATABASE_PATTERNS: readonly string[] = [
  "DROP",
  "OFFLINE DROP",
  "TEMPFILE ... DROP",
  "DATAFILE ... DROP",
  "BEGIN BACKUP",
  "END BACKUP",
  "RECOVER",
  "FLASHBACK"
];

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Determines whether a SQL string is destructive — i.e. capable of causing
 * irreversible data loss, schema loss, or significant production impact.
 *
 * The detector is resilient to formatting, whitespace, comments, string
 * literals, letter casing, and multi-line SQL. It intentionally over-approximates
 * (PL/SQL blocks are always flagged) because they can contain arbitrary
 * destructive statements that cannot be safely parsed without a full SQL engine.
 *
 * Usage: call from the approval-workflow gate for the `query` action on
 * PRODUCTION databases.
 */
export function isDestructiveSql(sql: string): DestructiveSqlResult {
  const stripped = stripCommentsAndStrings(sql);
  const normalized = normalizeWhitespace(stripped);
  const reasons: string[] = [];

  if (!normalized) {
    return { destructive: false, reasons, normalizedSql: normalized };
  }

  // 1) Top-level unconditional DML/DDL keywords.
  const matched = firstMatchedKeyword(normalized, DESTRUCTIVE_KEYWORDS);
  if (matched) {
    reasons.push(`Destructive SQL keyword detected: ${matched}`);
  }

  // 2) PL/SQL anonymous blocks — always flag since contents are opaque.
  const plsql = firstMatchedKeyword(normalized, PLSQL_BLOCK_STARTERS);
  if (plsql) {
    reasons.push(`PL/SQL block detected: ${plsql.trim()} — contents may contain destructive operations`);
  }

  // 3) ALTER TABLE with destructive sub-clauses.
  if (hasKeyword(normalized, "ALTER TABLE")) {
    for (const pattern of DESTRUCTIVE_ALTER_TABLE_PATTERNS) {
      if (normalized.includes(pattern)) {
        reasons.push(`Destructive ALTER TABLE operation: ${pattern}`);
        break;
      }
    }
  }

  // 4) ALTER DATABASE with destructive sub-clauses.
  if (hasKeyword(normalized, "ALTER DATABASE")) {
    for (const pattern of DESTRUCTIVE_ALTER_DATABASE_PATTERNS) {
      if (
        pattern === "TEMPFILE ... DROP" || pattern === "DATAFILE ... DROP"
          ? (normalized.includes("TEMPFILE") || normalized.includes("DATAFILE")) && normalized.includes("DROP")
          : normalized.includes(pattern)
      ) {
        reasons.push(`Destructive ALTER DATABASE operation: ${pattern}`);
        break;
      }
    }
  }

  // 5) DDL that indirectly causes data loss — GRANT/REVOKE are not destructive
  //    per the requirements, but ALTER SYSTEM (e.g. KILL SESSION, FLUSH)
  //    is impactful enough to require review on PROD.
  if (hasKeyword(normalized, "ALTER SYSTEM")) {
    reasons.push("ALTER SYSTEM statement — potential production impact");
  }

  return {
    destructive: reasons.length > 0,
    reasons,
    normalizedSql: normalized
  };
}

/**
 * Computes a short dedup signature from normalized SQL so that repeated
 * submissions of the exact same destructive query return the existing pending
 * approval request instead of creating duplicates, while different destructive
 * queries each get their own request.
 */
export function sqlDedupSignature(normalizedSql: string): string {
  // Use the first 200 chars of the normalized SQL — enough to be unique
  // for any realistic query while fitting cleanly in a DBMS_LOB.INSTR search.
  return normalizedSql.slice(0, 200);
}