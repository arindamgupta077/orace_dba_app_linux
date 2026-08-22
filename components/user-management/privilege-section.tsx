"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BadgePlus,
  CheckCircle2,
  Loader2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ApprovalTimeline } from "@/components/visual/approval-timeline";
import { useUserMgmt } from "@/hooks/use-user-mgmt";
import { cn } from "@/lib/utils";
import { TONE_STYLES, type CardTone } from "@/components/user-management/card-tones";
import type { DbaResponse } from "@/types/dba";

/* ── Types ─────────────────────────────────────────── */

type PrivModal =
  | "system_privilege"
  | "object_privilege"
  | "bulk_object_privilege"
  | "create_role"
  | "role_to_user"
  | "grant_sys_privs_role"
  | "grant_obj_privs_role"
  | "drop_role"
  | "check_privileges"
  | null;

type ModalStep = "form" | "result";

interface DropdownState {
  items: string[];
  typesMap?: Record<string, string>;
  loading: boolean;
  loaded: boolean;
}

const emptyDropdown = (): DropdownState => ({ items: [], typesMap: {}, loading: false, loaded: false });

/* ── Constants ─────────────────────────────────────── */

const SYSTEM_PRIVILEGES = [
  // Session & Connection
  "CREATE SESSION",
  "ALTER SESSION",
  "RESTRICTED SESSION",

  // Tables & Data Access
  "CREATE TABLE",
  "CREATE ANY TABLE",
  "ALTER ANY TABLE",
  "DROP ANY TABLE",
  "SELECT ANY TABLE",
  "INSERT ANY TABLE",
  "UPDATE ANY TABLE",
  "DELETE ANY TABLE",
  "READ ANY TABLE",
  "LOCK ANY TABLE",

  // Indexes
  "CREATE INDEX",
  "CREATE ANY INDEX",
  "ALTER ANY INDEX",
  "DROP ANY INDEX",

  // Views & Synonyms
  "CREATE VIEW",
  "CREATE ANY VIEW",
  "DROP ANY VIEW",
  "CREATE SYNONYM",
  "CREATE ANY SYNONYM",
  "CREATE PUBLIC SYNONYM",
  "DROP ANY SYNONYM",
  "DROP PUBLIC SYNONYM",

  // Sequences
  "CREATE SEQUENCE",
  "CREATE ANY SEQUENCE",
  "ALTER ANY SEQUENCE",
  "DROP ANY SEQUENCE",
  "SELECT ANY SEQUENCE",

  // Procedures, Functions, Packages
  "CREATE PROCEDURE",
  "CREATE ANY PROCEDURE",
  "ALTER ANY PROCEDURE",
  "DROP ANY PROCEDURE",
  "EXECUTE ANY PROCEDURE",

  // Triggers & Types
  "CREATE TRIGGER",
  "CREATE ANY TRIGGER",
  "ALTER ANY TRIGGER",
  "DROP ANY TRIGGER",
  "CREATE TYPE",
  "CREATE ANY TYPE",
  "ALTER ANY TYPE",
  "DROP ANY TYPE",
  "EXECUTE ANY TYPE",

  // Materialized Views & Directories
  "CREATE MATERIALIZED VIEW",
  "CREATE ANY MATERIALIZED VIEW",
  "ALTER ANY MATERIALIZED VIEW",
  "DROP ANY MATERIALIZED VIEW",
  "CREATE ANY DIRECTORY",
  "DROP ANY DIRECTORY",

  // User, Profile & Role Administration
  "CREATE USER",
  "ALTER USER",
  "DROP USER",
  "CREATE ROLE",
  "DROP ANY ROLE",
  "GRANT ANY ROLE",
  "GRANT ANY PRIVILEGE",
  "GRANT ANY OBJECT PRIVILEGE",
  "AUDIT ANY",
  "CREATE PROFILE",
  "ALTER ANY PROFILE",
  "DROP PROFILE",
  "EXEMPT ACCESS POLICY",

  // System, Tablespace & Storage Administration
  "ALTER SYSTEM",
  "ALTER DATABASE",
  "UNLIMITED TABLESPACE",
  "CREATE TABLESPACE",
  "ALTER TABLESPACE",
  "DROP TABLESPACE",
  "MANAGE TABLESPACE",

  // Jobs, Database Links & Debugging
  "CREATE JOB",
  "CREATE ANY JOB",
  "EXECUTE ANY JOB",
  "CREATE DATABASE LINK",
  "CREATE PUBLIC DATABASE LINK",
  "DROP PUBLIC DATABASE LINK",
  "ANALYZE ANY",
  "DEBUG CONNECT SESSION",
  "DEBUG ANY PROCEDURE"
] as const;

const OBJECT_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "EXECUTE",
  "REFERENCES",
  "ALTER"
] as const;

/** Oracle Object Type -> Supported Privileges Matrix */
const OBJECT_TYPE_PRIVILEGES: Record<string, string[]> = {
  TABLE: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "REFERENCES"],
  VIEW: ["SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES"],
  SEQUENCE: ["SELECT", "ALTER"],
  PROCEDURE: ["EXECUTE"],
  FUNCTION: ["EXECUTE"],
  PACKAGE: ["EXECUTE"],
  TYPE: ["EXECUTE"],
  "MATERIALIZED VIEW": ["SELECT", "ALTER"],
  DIRECTORY: ["READ", "WRITE", "EXECUTE"]
};

/** Calculate valid privileges for selected objects based on their Oracle object types */
function getValidPrivilegesForSelectedObjects(
  selectedNames: string[],
  typesMap: Record<string, string> = {}
): {
  validPrivileges: Set<string>;
  disabledPrivilegeReasons: Record<string, string>;
  selectedTypes: string[];
  isIncompatible: boolean;
} {
  if (selectedNames.length === 0) {
    return {
      validPrivileges: new Set(OBJECT_PRIVILEGES),
      disabledPrivilegeReasons: {},
      selectedTypes: [],
      isIncompatible: false
    };
  }

  const typesSet = new Set<string>();
  for (const name of selectedNames) {
    const rawType = typesMap[name] || "TABLE";
    typesSet.add(rawType.toUpperCase());
  }

  const selectedTypes = Array.from(typesSet);
  let intersection: Set<string> | null = null;

  for (const type of selectedTypes) {
    const supported = OBJECT_TYPE_PRIVILEGES[type] || OBJECT_PRIVILEGES;
    const supportedSet = new Set(supported);

    if (intersection === null) {
      intersection = new Set(supported);
    } else {
      const nextIntersection = new Set<string>();
      for (const priv of intersection) {
        if (supportedSet.has(priv)) {
          nextIntersection.add(priv);
        }
      }
      intersection = nextIntersection;
    }
  }

  const validPrivileges = intersection || new Set<string>();
  const disabledReasons: Record<string, string> = {};

  for (const priv of OBJECT_PRIVILEGES) {
    if (!validPrivileges.has(priv)) {
      const incompatibleTypes = selectedTypes.filter((type) => {
        const supported = OBJECT_TYPE_PRIVILEGES[type] || OBJECT_PRIVILEGES;
        return !supported.includes(priv);
      });
      disabledReasons[priv] = `Not supported for ${incompatibleTypes.join(", ")}`;
    }
  }

  const isIncompatible = selectedNames.length > 0 && validPrivileges.size === 0;

  return {
    validPrivileges,
    disabledPrivilegeReasons: disabledReasons,
    selectedTypes,
    isIncompatible
  };
}

/** Oracle GRANT uses TO; REVOKE uses FROM. */
const grantRevokeTarget = (operation: string) =>
  operation === "REVOKE" ? "FROM" : "TO";

/* ── Privilege Cards ───────────────────────────────── */

const PRIV_CARDS: {
  modal: PrivModal;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: CardTone;
  destructive?: boolean;
}[] = [
  {
    modal: "check_privileges" as PrivModal,
    label: "Check User Privileges",
    description: "View all granted system privileges, roles, and object-level privileges for a database user.",
    icon: ShieldCheck,
    tone: "cyan"
  },
  {
    modal: "system_privilege" as PrivModal,
    label: "Grant / Revoke System Privileges",
    description: "Grant or revoke Oracle system-level privileges to/from a user.",
    icon: ShieldAlert,
    tone: "violet"
  },
  {
    modal: "bulk_object_privilege" as PrivModal,
    label: "Grant / Revoke Object Privileges",
    description: "Grant or revoke privileges on single or multiple objects (or all objects of a schema) in one operation.",
    icon: Shield,
    tone: "blue"
  },
  {
    modal: "create_role" as PrivModal,
    label: "Create Role",
    description: "Create a new Oracle role to group privileges for easy assignment.",
    icon: BadgePlus,
    tone: "emerald"
  },
  {
    modal: "role_to_user" as PrivModal,
    label: "Grant / Revoke Role",
    description: "Grant or revoke an Oracle role to/from a database user.",
    icon: BadgeCheck,
    tone: "teal"
  },
  {
    modal: "grant_sys_privs_role" as PrivModal,
    label: "Grant / Revoke System Privileges to Role",
    description: "Grant or revoke Oracle system-level privileges to/from a role.",
    icon: ShieldCheck,
    tone: "indigo"
  },
  {
    modal: "grant_obj_privs_role" as PrivModal,
    label: "Grant / Revoke Object Privileges to Role",
    description: "Grant or revoke SELECT, INSERT, UPDATE, DELETE, EXECUTE on objects to a role.",
    icon: ShieldAlert,
    tone: "fuchsia"
  },
  {
    modal: "drop_role" as PrivModal,
    label: "Drop Role",
    description: "Permanently drop an Oracle role from the database.",
    icon: Trash2,
    tone: "cyan",
    destructive: true
  }
];

/* ── Result Panel ──────────────────────────────────── */

function ResultPanel({ result, error }: { result: DbaResponse | null; error: string | null }) {
  const isError = Boolean(error) || result?.status === "error";
  const isPendingApproval = result?.status === "pending_approval";
  const rows = useMemo(
    () => (result?.raw_data?.rows ?? []) as Record<string, unknown>[],
    [result]
  );

  // Extract key metadata from first row if available
  const sampleRow = rows[0] || {};
  const grantee = String(sampleRow.GRANTEE || sampleRow.grantee || sampleRow.USERNAME || sampleRow.username || "");
  const owner = String(sampleRow.OWNER || sampleRow.owner || "");

  let summary = result?.ai_summary || error || "";
  if (summary.includes("for user .") && grantee) {
    summary = summary.replace("for user .", `for user ${grantee}.`);
  }

  const [filterText, setFilterText] = useState("");
  const [showRawOutput, setShowRawOutput] = useState(false);

  // Filter rows based on search text
  const filteredRows = useMemo(() => {
    if (!filterText.trim()) return rows;
    const q = filterText.toLowerCase();
    return rows.filter((r) =>
      Object.values(r).some((val) => String(val ?? "").toLowerCase().includes(q))
    );
  }, [rows, filterText]);

  const getPrivilegeBadge = (priv: string) => {
    const upper = priv.toUpperCase();
    if (upper.includes("SELECT")) return "bg-cyan-500/15 text-cyan-700 border-cyan-500/30 dark:text-cyan-300";
    if (upper.includes("INSERT")) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300";
    if (upper.includes("UPDATE")) return "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300";
    if (upper.includes("DELETE")) return "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300";
    if (upper.includes("EXECUTE")) return "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300";
    return "bg-secondary text-secondary-foreground border-border/40";
  };

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 ${
          isError
            ? "border-red-500/40 bg-red-500/10 text-red-200"
            : isPendingApproval
            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        }`}
      >
        {isError ? (
          <XCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
        ) : isPendingApproval ? (
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm leading-none">
            {isError ? "Action Failed" : isPendingApproval ? "Pending Administrator Approval" : "Action Succeeded"}
          </p>
          {summary && <p className="mt-1.5 text-xs opacity-90 leading-relaxed">{summary}</p>}
        </div>
      </div>

      {isPendingApproval && result?.approval?.steps && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="mb-3 text-xs font-semibold text-amber-300">Approval Workflow Steps</p>
          <ApprovalTimeline steps={result.approval.steps} />
        </div>
      )}

      {/* Metadata Badges Bar */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {grantee && (
            <Badge variant="outline" className="bg-background/40 font-mono">
              Grantee: <span className="text-cyan-400 ml-1">{grantee}</span>
            </Badge>
          )}
          {owner && (
            <Badge variant="outline" className="bg-background/40 font-mono">
              Owner: <span className="text-cyan-400 ml-1">{owner}</span>
            </Badge>
          )}
          <Badge variant="outline" className="bg-background/40 font-mono">
            Verified Privileges: <span className="text-emerald-400 ml-1">{rows.length}</span>
          </Badge>
        </div>
      )}

      {/* Table Results */}
      {rows.length > 0 && (
        <div className="rounded-lg border border-border/60 overflow-hidden bg-background/50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/20 gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Confirmation Query Result
            </span>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search table or privilege…"
              className="h-7 w-48 rounded border border-input bg-background px-2 text-xs placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border/60 z-10">
                <tr>
                  {Object.keys(rows[0]).map((col) => (
                    <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 font-mono">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={Object.keys(rows[0]).length} className="px-3 py-4 text-center text-muted-foreground italic">
                      No matching records found for &ldquo;{filterText}&rdquo;
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      {Object.entries(row).map(([col, val], j) => {
                        const strVal = String(val ?? "—");
                        const upperCol = col.toUpperCase();

                        if (upperCol === "PRIVILEGE") {
                          return (
                            <td key={j} className="px-3 py-1.5 whitespace-nowrap">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-mono ${getPrivilegeBadge(strVal)}`}>
                                {strVal}
                              </Badge>
                            </td>
                          );
                        }

                        if (upperCol === "GRANTABLE") {
                          return (
                            <td key={j} className="px-3 py-1.5 whitespace-nowrap">
                              <span className={strVal === "YES" ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>
                                {strVal}
                              </span>
                            </td>
                          );
                        }

                        return (
                          <td key={j} className="px-3 py-1.5 whitespace-nowrap text-foreground/90">
                            {strVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-3 py-1.5 border-t border-border/40 text-[11px] text-muted-foreground flex justify-between bg-muted/10">
            <span>Showing {filteredRows.length} of {rows.length} records</span>
            {filterText && <span>Filtered by &ldquo;{filterText}&rdquo;</span>}
          </div>
        </div>
      )}

      {/* Collapsible Execution Output Details */}
      {result?.raw_output && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowRawOutput(!showRawOutput)}
            className="text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 font-medium hover:underline flex items-center gap-1"
          >
            {showRawOutput ? "Hide" : "View"} Execution Output Details
          </button>
          {showRawOutput && (
            <pre className="keep-dark rounded-md border border-slate-800 bg-slate-950 p-3 text-[11px] font-mono text-emerald-400 dark:text-emerald-300 overflow-x-auto max-h-48 whitespace-pre-wrap leading-relaxed shadow-inner">
              {result.raw_output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Lazy Dropdown ─────────────────────────────────── */

/** Max items to render inside a Radix Select to avoid DOM bloat */
const MAX_SELECT_ITEMS = 500;

function LazySelect({
  value,
  onChange,
  placeholder,
  state,
  onOpen
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  state: DropdownState;
  onOpen: () => void;
}) {
  // Deduplicate + cap rendered items as safety net
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of state.items) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
      if (result.length >= MAX_SELECT_ITEMS) break;
    }
    return result;
  }, [state.items]);

  return (
    <Select
      value={value}
      onValueChange={onChange}
      onOpenChange={(open) => { if (open) onOpen(); }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={state.loading ? "Loading…" : placeholder} />
        {state.loading && <Loader2 className="h-3 w-3 animate-spin ml-2 shrink-0" />}
      </SelectTrigger>
      <SelectContent>
        {uniqueItems.length === 0 && !state.loading && (
          <SelectItem value="__none" disabled>No data — open again to retry</SelectItem>
        )}
        {uniqueItems.map((item) => (
          <SelectItem key={item} value={item}>{item}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── Searchable Object Select (handles huge lists) ──── */

/** Max items shown in the filtered dropdown to prevent DOM bloat */
const MAX_VISIBLE_ITEMS = 200;

function SearchableObjectSelect({
  value,
  onChange,
  placeholder,
  state,
  onOpen
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  state: DropdownState;
  onOpen: () => void;
}) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Deduplicate items
  const uniqueItems = useMemo(() => [...new Set(state.items)], [state.items]);

  // Filter + cap rendered items
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const source = q ? uniqueItems.filter((item) => item.toUpperCase().includes(q)) : uniqueItems;
    return source.slice(0, MAX_VISIBLE_ITEMS);
  }, [uniqueItems, search]);

  const totalMatches = useMemo(() => {
    const q = search.trim().toUpperCase();
    return q ? uniqueItems.filter((item) => item.toUpperCase().includes(q)).length : uniqueItems.length;
  }, [uniqueItems, search]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset search when items change (owner changed)
  useEffect(() => {
    setSearch("");
  }, [state.items]);

  const handleSelect = (item: string) => {
    onChange(item);
    setSearch("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex h-10 w-full items-center rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring"
        onClick={() => {
          setIsOpen(true);
          onOpen();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? search : (value || "")}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            onOpen();
            if (value && !search) setSearch("");
          }}
          placeholder={state.loading ? "Loading…" : (value || placeholder)}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground min-w-0"
          autoComplete="off"
        />
        {state.loading && <Loader2 className="h-3 w-3 animate-spin ml-2 shrink-0" />}
        {value && !isOpen && (
          <button
            type="button"
            className="ml-1 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setSearch("");
            }}
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="max-h-60 overflow-y-auto p-1">
            {state.loading && uniqueItems.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading objects…
              </div>
            )}
            {!state.loading && uniqueItems.length === 0 && (
              <div className="py-3 text-center text-sm text-muted-foreground">
                No objects found — select an owner first
              </div>
            )}
            {filtered.length === 0 && uniqueItems.length > 0 && !state.loading && (
              <div className="py-3 text-center text-sm text-muted-foreground">
                No objects match &ldquo;{search}&rdquo;
              </div>
            )}
            {filtered.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => handleSelect(item)}
                className={`relative flex w-full cursor-default select-none items-center justify-between rounded-sm py-1.5 pl-8 pr-2.5 text-sm outline-none hover:bg-secondary hover:text-secondary-foreground ${
                  value === item ? "bg-secondary/60 text-secondary-foreground font-medium" : ""
                }`}
              >
                {value === item && (
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />
                  </span>
                )}
                <span className="font-mono text-xs truncate">{item}</span>
                {state.typesMap?.[item] && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground/80 border-border/40 font-mono shrink-0">
                    {state.typesMap[item]}
                  </Badge>
                )}
              </button>
            ))}
            {totalMatches > MAX_VISIBLE_ITEMS && (
              <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground text-center">
                Showing {MAX_VISIBLE_ITEMS} of {totalMatches} matches — type to narrow results
              </div>
            )}
          </div>
          {uniqueItems.length > 0 && (
            <div className="border-t border-border/40 px-3 py-1.5 text-xs text-muted-foreground">
              {totalMatches} object{totalMatches !== 1 ? "s" : ""}{search ? " matching" : " total"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Searchable Multi-Object Select (handles huge lists + multi-selection) ─── */

function SearchableMultiObjectSelect({
  selected,
  onChange,
  placeholder,
  state,
  onOpen
}: {
  selected: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  state: DropdownState;
  onOpen: () => void;
}) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Deduplicate items
  const uniqueItems = useMemo(() => [...new Set(state.items)], [state.items]);

  // Filter + cap rendered items
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const source = q ? uniqueItems.filter((item) => item.toUpperCase().includes(q)) : uniqueItems;
    return source.slice(0, MAX_VISIBLE_ITEMS);
  }, [uniqueItems, search]);

  const totalMatches = useMemo(() => {
    const q = search.trim().toUpperCase();
    return q ? uniqueItems.filter((item) => item.toUpperCase().includes(q)).length : uniqueItems.length;
  }, [uniqueItems, search]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset search when items change (owner changed)
  useEffect(() => {
    setSearch("");
  }, [state.items]);

  const toggleItem = (item: string) => {
    if (selected.includes(item)) {
      onChange(selected.filter((s) => s !== item));
    } else {
      onChange([...selected, item]);
    }
  };

  const selectAllFiltered = () => {
    const q = search.trim().toUpperCase();
    const matching = q ? uniqueItems.filter((item) => item.toUpperCase().includes(q)) : uniqueItems;
    const combined = [...new Set([...selected, ...matching])];
    onChange(combined);
  };

  const deselectAllFiltered = () => {
    const q = search.trim().toUpperCase();
    const matchingSet = new Set(q ? uniqueItems.filter((item) => item.toUpperCase().includes(q)) : uniqueItems);
    onChange(selected.filter((s) => !matchingSet.has(s)));
  };

  const clearAll = () => {
    onChange([]);
  };

  const MAX_DISPLAY_CHIPS = 3;
  const displayedChips = selected.slice(0, MAX_DISPLAY_CHIPS);
  const hiddenChipCount = selected.length - MAX_DISPLAY_CHIPS;

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>
          Object Names{" "}
          {selected.length > 0 && (
            <span className="text-cyan-400 text-xs font-normal">
              ({selected.length} selected{uniqueItems.length > 0 ? ` of ${uniqueItems.length}` : ""})
            </span>
          )}
        </Label>
        {selected.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={clearAll}
          >
            Clear selection
          </Button>
        )}
      </div>

      <div
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background/50 p-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring cursor-text"
        onClick={() => {
          setIsOpen(true);
          onOpen();
          inputRef.current?.focus();
        }}
      >
        {displayedChips.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-xs text-cyan-300 font-mono shrink-0"
          >
            {item}
            <button
              type="button"
              className="hover:text-cyan-700 focus:outline-none dark:hover:text-cyan-100"
              onClick={(e) => {
                e.stopPropagation();
                toggleItem(item);
              }}
            >
              <XCircle className="h-3 w-3" />
            </button>
          </span>
        ))}

        {hiddenChipCount > 0 && (
          <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground font-mono shrink-0">
            +{hiddenChipCount} more
          </span>
        )}

        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            onOpen();
          }}
          placeholder={
            state.loading
              ? "Loading objects…"
              : selected.length === 0
              ? placeholder
              : "Filter objects…"
          }
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground min-w-[120px] text-sm"
          autoComplete="off"
        />

        {state.loading && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto shrink-0 text-muted-foreground" />}
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          {uniqueItems.length > 0 && !state.loading && (
            <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5 text-xs bg-muted/20">
              <span className="text-muted-foreground font-medium">
                {search ? `Matching "${search}" (${totalMatches})` : `All Objects (${uniqueItems.length})`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-cyan-600 hover:text-cyan-700 font-medium hover:underline text-[11px] dark:text-cyan-400 dark:hover:text-cyan-300"
                >
                  Select {search ? "Matching" : "All"}
                </button>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={deselectAllFiltered}
                    className="text-muted-foreground hover:text-foreground font-medium hover:underline text-[11px]"
                  >
                    Deselect {search ? "Matching" : "All"}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto p-1">
            {state.loading && uniqueItems.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading objects…
              </div>
            )}
            {!state.loading && uniqueItems.length === 0 && (
              <div className="py-3 text-center text-sm text-muted-foreground">
                No objects found — select an owner first
              </div>
            )}
            {filtered.length === 0 && uniqueItems.length > 0 && !state.loading && (
              <div className="py-3 text-center text-sm text-muted-foreground">
                No objects match &ldquo;{search}&rdquo;
              </div>
            )}
            {filtered.map((item) => {
              const isSelected = selected.includes(item);
              const objectType = state.typesMap?.[item];
              return (
                <button
                  key={item}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleItem(item);
                  }}
                  className={`relative flex w-full cursor-pointer select-none items-center justify-between gap-2.5 rounded-sm py-1.5 px-2.5 text-sm outline-none transition-colors hover:bg-secondary hover:text-secondary-foreground ${
                    isSelected ? "bg-secondary/60 text-secondary-foreground font-medium" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`h-4 w-4 shrink-0 rounded border transition-colors flex items-center justify-center ${
                        isSelected ? "border-cyan-400 bg-cyan-400/20 text-cyan-400" : "border-border/60"
                      }`}
                    >
                      {isSelected && (
                        <svg className="h-2.5 w-2.5 stroke-current" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="font-mono text-xs truncate">{item}</span>
                  </div>
                  {objectType && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground/80 border-border/40 font-mono shrink-0">
                      {objectType}
                    </Badge>
                  )}
                </button>
              );
            })}
            {totalMatches > MAX_VISIBLE_ITEMS && (
              <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground text-center">
                Showing {MAX_VISIBLE_ITEMS} of {totalMatches} matches — type to narrow results
              </div>
            )}
          </div>
          {uniqueItems.length > 0 && (
            <div className="border-t border-border/40 px-3 py-1.5 text-xs text-muted-foreground flex justify-between">
              <span>{totalMatches} object{totalMatches !== 1 ? "s" : ""}{search ? " matching" : " total"}</span>
              <span>{selected.length} selected</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Multi-Checkbox select ─────────────────────────── */

function MultiPrivilegeSelector<T extends string>({
  options,
  selected,
  onChange,
  label,
  disabledOptions = {}
}: {
  options: readonly T[];
  selected: T[];
  onChange: (items: T[]) => void;
  label: string;
  disabledOptions?: Record<string, string>;
}) {
  const [filterText, setFilterText] = useState("");

  const toggle = (item: T) => {
    if (disabledOptions[item]) return;
    if (selected.includes(item)) onChange(selected.filter((s) => s !== item));
    else onChange([...selected, item]);
  };

  const filteredOptions = useMemo(() => {
    if (!filterText.trim()) return options;
    const q = filterText.trim().toUpperCase();
    return options.filter((opt) => opt.toUpperCase().includes(q));
  }, [options, filterText]);

  const selectAllFiltered = () => {
    const validFiltered = filteredOptions.filter((opt) => !disabledOptions[opt]);
    const next = Array.from(new Set([...selected, ...validFiltered]));
    onChange(next);
  };

  const deselectAllFiltered = () => {
    const filteredSet = new Set(filteredOptions);
    onChange(selected.filter((s) => !filteredSet.has(s)));
  };

  const showSearch = options.length > 8;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>
          {label}{" "}
          {selected.length > 0 && (
            <span className="text-cyan-400 text-xs font-mono font-medium">
              ({selected.length} of {options.length} selected)
            </span>
          )}
        </Label>
        {selected.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onChange([])}
          >
            Clear selection
          </Button>
        )}
      </div>

      {showSearch && (
        <div className="flex items-center justify-between gap-2">
          <Input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search privileges (e.g. TABLE, USER, SESSION)..."
            className="h-8 text-xs font-mono bg-background/50 placeholder:font-sans"
          />
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2 text-[11px] font-mono text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10"
              onClick={selectAllFiltered}
            >
              {filterText ? "Select Filtered" : "Select All"}
            </Button>
            {selected.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-[11px] font-mono text-muted-foreground"
                onClick={deselectAllFiltered}
              >
                Deselect
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-md border border-border/60 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto bg-background/30">
        {filteredOptions.length === 0 ? (
          <div className="col-span-full py-4 text-center text-xs text-muted-foreground italic">
            No privileges matching &ldquo;{filterText}&rdquo;
          </div>
        ) : (
          filteredOptions.map((opt) => {
            const isDisabled = !!disabledOptions[opt];
            const isSelected = selected.includes(opt);
            const reason = disabledOptions[opt];

            return (
              <label
                key={opt}
                title={reason || opt}
                className={`flex items-start gap-2 p-1 rounded hover:bg-muted/20 transition-colors group ${
                  isDisabled ? "opacity-45 cursor-not-allowed select-none" : "cursor-pointer"
                }`}
              >
                <div
                  className={`h-4 w-4 shrink-0 rounded border transition-colors mt-0.5 ${
                    isSelected
                      ? "border-cyan-400 bg-cyan-400/20"
                      : isDisabled
                      ? "border-border/40 bg-muted/30"
                      : "border-border/60 group-hover:border-border"
                  } flex items-center justify-center`}
                  onClick={() => toggle(opt)}
                >
                  {isSelected && (
                    <svg className="h-2.5 w-2.5 text-cyan-400" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div className="flex flex-col min-w-0 flex-1" onClick={() => toggle(opt)}>
                  <span
                    className={`text-xs font-mono ${
                      isDisabled
                        ? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
                        : isSelected
                        ? "text-cyan-300 font-semibold"
                        : "group-hover:text-foreground text-muted-foreground"
                    } transition-colors leading-tight truncate`}
                  >
                    {opt}
                  </span>
                  {isDisabled && reason && (
                    <span className="text-[9px] text-amber-400/90 font-normal truncate">
                      {reason}
                    </span>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>

      {filterText && filteredOptions.length > 0 && (
        <div className="text-[11px] text-muted-foreground flex justify-between px-1">
          <span>Showing {filteredOptions.length} of {options.length} privileges</span>
          <button
            type="button"
            onClick={() => setFilterText("")}
            className="text-cyan-400 hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main Section ──────────────────────────────────── */

export function PrivilegeManagementSection() {
  const { execute, loadDropdown, loadObjectsWithMetadata, executing, selectedDb } = useUserMgmt();

  const [activeModal, setActiveModal] = useState<PrivModal>(null);
  const [modalStep, setModalStep] = useState<ModalStep>("form");
  const [modalResult, setModalResult] = useState<DbaResponse | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, string>>({});
  const [selectedSysPrivs, setSelectedSysPrivs] = useState<string[]>([]);
  const [selectedObjPrivs, setSelectedObjPrivs] = useState<string[]>([]);
  const [selectedObjectNames, setSelectedObjectNames] = useState<string[]>([]);
  const [allObjectsSelected, setAllObjectsSelected] = useState(false);

  // Check privileges inline result
  const [checkPrivsResult, setCheckPrivsResult] = useState<DbaResponse | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("user_mgmt_check_privileges");
      if (saved) {
        setCheckPrivsResult(JSON.parse(saved));
      }
    } catch {}
  }, []);

  const [schemas, setSchemas] = useState<DropdownState>(emptyDropdown);
  const [roles, setRoles] = useState<DropdownState>(emptyDropdown);
  const [objects, setObjects] = useState<DropdownState>(emptyDropdown);

  const loadingRef = useRef<Record<string, boolean>>({});

  const ensureSchemas = useCallback(async () => {
    if (schemas.loaded || schemas.loading || loadingRef.current["schemas"]) return;
    loadingRef.current["schemas"] = true;
    setSchemas({ items: [], loading: true, loaded: false });
    const items = await loadDropdown("schema_list", {}, "username");
    setSchemas({ items, loading: false, loaded: true });
    loadingRef.current["schemas"] = false;
  }, [schemas.loaded, schemas.loading, loadDropdown]);

  const ensureRoles = useCallback(async () => {
    if (roles.loaded || roles.loading || loadingRef.current["roles"]) return;
    loadingRef.current["roles"] = true;
    setRoles({ items: [], loading: true, loaded: false });
    const items = await loadDropdown("fetch_roles", {}, "role");
    setRoles({ items, loading: false, loaded: true });
    loadingRef.current["roles"] = false;
  }, [roles.loaded, roles.loading, loadDropdown]);

  const loadObjects = useCallback(async (owner: string) => {
    if (!owner) return;
    loadingRef.current["objects"] = true;
    setObjects({ items: [], typesMap: {}, loading: true, loaded: false });
    const metaList = await loadObjectsWithMetadata(owner);
    const items = metaList.map((item) => item.name);
    const typesMap: Record<string, string> = {};
    for (const item of metaList) {
      typesMap[item.name] = item.type;
    }
    setObjects({ items, typesMap, loading: false, loaded: true });
    loadingRef.current["objects"] = false;
  }, [loadObjectsWithMetadata]);

  // Validation calculations for Bulk Object Privileges
  const bulkPrivValidation = useMemo(() => {
    if (allObjectsSelected || selectedObjectNames.length === 0) {
      return {
        validPrivileges: new Set(OBJECT_PRIVILEGES),
        disabledPrivilegeReasons: {},
        selectedTypes: [],
        isIncompatible: false
      };
    }
    return getValidPrivilegesForSelectedObjects(selectedObjectNames, objects.typesMap || {});
  }, [allObjectsSelected, selectedObjectNames, objects.typesMap]);

  // Validation calculations for Single Object Privileges
  const singleObjectValidation = useMemo(() => {
    const objName = form.object_name;
    if (!objName) {
      return {
        validPrivileges: new Set(OBJECT_PRIVILEGES),
        disabledPrivilegeReasons: {},
        selectedTypes: [],
        isIncompatible: false
      };
    }
    return getValidPrivilegesForSelectedObjects([objName], objects.typesMap || {});
  }, [form.object_name, objects.typesMap]);

  // Automatically deselect invalid privileges when object selection changes in bulk mode
  useEffect(() => {
    if (activeModal === "bulk_object_privilege" && !allObjectsSelected && selectedObjectNames.length > 0) {
      const cleaned = selectedObjPrivs.filter((priv) => bulkPrivValidation.validPrivileges.has(priv));
      if (cleaned.length !== selectedObjPrivs.length) {
        setSelectedObjPrivs(cleaned);
      }
    }
  }, [selectedObjectNames, allObjectsSelected, activeModal, bulkPrivValidation.validPrivileges, selectedObjPrivs]);

  // Automatically deselect invalid privileges when single object changes
  useEffect(() => {
    if ((activeModal === "object_privilege" || activeModal === "grant_obj_privs_role") && form.object_name) {
      const cleaned = selectedObjPrivs.filter((priv) => singleObjectValidation.validPrivileges.has(priv));
      if (cleaned.length !== selectedObjPrivs.length) {
        setSelectedObjPrivs(cleaned);
      }
    }
  }, [form.object_name, activeModal, singleObjectValidation.validPrivileges, selectedObjPrivs]);

  // When "All Objects" is selected, keep the visible selection in sync with loaded objects
  useEffect(() => {
    if (allObjectsSelected) setSelectedObjectNames(objects.items);
  }, [objects.items, allObjectsSelected]);

  const setField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openModal = (modal: PrivModal) => {
    setActiveModal(modal);
    setModalStep("form");
    setModalResult(null);
    setModalError(null);
    setForm({});
    setSelectedSysPrivs([]);
    setSelectedObjPrivs([]);
    setSelectedObjectNames([]);
    setAllObjectsSelected(false);
    setObjects({ items: [], loading: false, loaded: false });
    // Schemas are used as usernames and object owners
    const needsSchemas = ["system_privilege", "object_privilege", "bulk_object_privilege", "role_to_user", "grant_obj_privs_role", "check_privileges"].includes(modal ?? "");
    const needsRoles = ["role_to_user", "grant_sys_privs_role", "grant_obj_privs_role", "drop_role"].includes(modal ?? "");
    if (needsSchemas) ensureSchemas();
    if (needsRoles) ensureRoles();
  };

  const closeModal = () => {
    setActiveModal(null);
    setModalStep("form");
    setModalResult(null);
    setModalError(null);
    setForm({});
    setSelectedSysPrivs([]);
    setSelectedObjPrivs([]);
    setSelectedObjectNames([]);
    setAllObjectsSelected(false);
  };

  const handleSubmit = async () => {
    setModalError(null);
    setModalResult(null);
    try {
      let res: DbaResponse;
      switch (activeModal) {
        case "check_privileges":
          res = await execute("check_privileges", {
            username: form.username
          });
          setCheckPrivsResult(res);
          try {
            sessionStorage.setItem("user_mgmt_check_privileges", JSON.stringify(res));
          } catch {}
          closeModal();
          return;
        case "system_privilege":
          res = await execute("system_privilege", {
            username: form.username,
            operation: form.operation,
            system_privilege: selectedSysPrivs
          });
          break;
        case "object_privilege":
          res = await execute("object_privilege", {
            username: form.username,
            operation: form.operation,
            owner_name: form.owner_name,
            object_name: form.object_name,
            object_privilege: selectedObjPrivs
          });
          break;
        case "create_role":
          res = await execute("create_role", { role_name: form.role_name });
          break;
        case "role_to_user":
          res = await execute("role_to_user", {
            username: form.username,
            role: form.role,
            operation: form.operation
          });
          break;
        case "bulk_object_privilege":
          res = await execute(
            "bulk_object_privilege",
            allObjectsSelected
              ? {
                  username: form.username,
                  operation: form.operation,
                  owner_name: form.owner_name,
                  object_privilege: selectedObjPrivs,
                  all_objects: true
                }
              : {
                  username: form.username,
                  operation: form.operation,
                  owner_name: form.owner_name,
                  object_name: selectedObjectNames,
                  object_privilege: selectedObjPrivs,
                  all_objects: false
                }
          );
          break;
        case "grant_sys_privs_role":
          res = await execute("grant_sys_privs_role", {
            role: form.role,
            operation: form.operation,
            system_privilege: selectedSysPrivs
          });
          break;
        case "grant_obj_privs_role":
          res = await execute("grant_obj_privs_role", {
            role: form.role,
            operation: form.operation,
            owner_name: form.owner_name,
            object_name: form.object_name,
            object_privilege: selectedObjPrivs
          });
          break;
        case "drop_role":
          res = await execute("drop_role", { role: form.role });
          break;
        default:
          return;
      }
      setModalResult(res);
      setModalStep("result");
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Request failed");
      setModalStep("result");
    }
  };

  const isSubmitDisabled = () => {
    if (executing) return true;
    switch (activeModal) {
      case "check_privileges":
        return !form.username;
      case "system_privilege":
        return !form.username || !form.operation || selectedSysPrivs.length === 0;
      case "object_privilege":
        return (
          !form.username ||
          !form.operation ||
          !form.owner_name ||
          !form.object_name ||
          selectedObjPrivs.length === 0 ||
          selectedObjPrivs.some((p) => !singleObjectValidation.validPrivileges.has(p))
        );
      case "bulk_object_privilege":
        return (
          !form.username ||
          !form.operation ||
          !form.owner_name ||
          (!allObjectsSelected && selectedObjectNames.length === 0) ||
          selectedObjPrivs.length === 0 ||
          bulkPrivValidation.isIncompatible ||
          (!allObjectsSelected && selectedObjPrivs.some((p) => !bulkPrivValidation.validPrivileges.has(p)))
        );
      case "create_role":
        return !form.role_name;
      case "role_to_user":
        return !form.username || !form.role || !form.operation;
      case "grant_sys_privs_role":
        return !form.role || !form.operation || selectedSysPrivs.length === 0;
      case "grant_obj_privs_role":
        return (
          !form.role ||
          !form.operation ||
          !form.owner_name ||
          !form.object_name ||
          selectedObjPrivs.length === 0 ||
          selectedObjPrivs.some((p) => !singleObjectValidation.validPrivileges.has(p))
        );
      case "drop_role":
        return !form.role;
      default:
        return true;
    }
  };

  const getModalTitle = () => PRIV_CARDS.find((c) => c.modal === activeModal)?.label ?? "";

  const OperationToggle = () => (
    <div className="space-y-1.5">
      <Label>Operation</Label>
      <div className="flex gap-2">
        {["GRANT", "REVOKE"].map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => setField("operation", op)}
            className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              form.operation === op
                ? op === "GRANT"
                  ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300"
                  : "border-red-400/60 bg-red-400/15 text-red-300"
                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {op}
          </button>
        ))}
      </div>
    </div>
  );

  const renderFormContent = () => {
    switch (activeModal) {
      case "check_privileges":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Database User</Label>
              <LazySelect
                value={form.username ?? ""}
                onChange={(v) => setField("username", v)}
                placeholder="Select user…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            {form.username && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">Query all system privileges, granted roles, and object privileges for {form.username}</code>
              </p>
            )}
          </div>
        );

      case "system_privilege":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <LazySelect
                value={form.username ?? ""}
                onChange={(v) => setField("username", v)}
                placeholder="Select user…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            <OperationToggle />
            <MultiPrivilegeSelector
              options={SYSTEM_PRIVILEGES}
              selected={selectedSysPrivs as typeof SYSTEM_PRIVILEGES[number][]}
              onChange={setSelectedSysPrivs as (items: typeof SYSTEM_PRIVILEGES[number][]) => void}
              label="System Privileges"
            />
            {form.username && form.operation && selectedSysPrivs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">{form.operation} {selectedSysPrivs.join(", ")} {grantRevokeTarget(form.operation)} {form.username};</code>
              </p>
            )}
          </div>
        );

      case "object_privilege":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Grantee (Username)</Label>
              <LazySelect
                value={form.username ?? ""}
                onChange={(v) => setField("username", v)}
                placeholder="Select user…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            <OperationToggle />
            <div className="space-y-1.5">
              <Label>Object Owner</Label>
              <LazySelect
                value={form.owner_name ?? ""}
                onChange={(v) => {
                  setField("owner_name", v);
                  setField("object_name", "");
                  loadObjects(v);
                }}
                placeholder="Select owner…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Object Name</Label>
              <SearchableObjectSelect
                value={form.object_name ?? ""}
                onChange={(v) => setField("object_name", v)}
                placeholder={form.owner_name ? "Search object…" : "Select owner first…"}
                state={objects}
                onOpen={() => { if (form.owner_name) loadObjects(form.owner_name); }}
              />
            </div>
            <MultiPrivilegeSelector
              options={OBJECT_PRIVILEGES}
              selected={selectedObjPrivs as typeof OBJECT_PRIVILEGES[number][]}
              onChange={setSelectedObjPrivs as (items: typeof OBJECT_PRIVILEGES[number][]) => void}
              disabledOptions={singleObjectValidation.disabledPrivilegeReasons}
              label="Object Privileges"
            />
            {form.username && form.operation && form.owner_name && form.object_name && selectedObjPrivs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">{form.operation} {selectedObjPrivs.join(", ")} ON {form.owner_name}.{form.object_name} {grantRevokeTarget(form.operation)} {form.username};</code>
              </p>
            )}
          </div>
        );

      case "create_role":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role Name <span className="text-red-400">*</span></Label>
              <Input
                value={form.role_name ?? ""}
                onChange={(e) => setField("role_name", e.target.value)}
                placeholder="DEVELOPER_ROLE"
                className="uppercase"
              />
            </div>
            {form.role_name && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">CREATE ROLE {form.role_name};</code>
              </p>
            )}
          </div>
        );

      case "role_to_user":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <LazySelect
                value={form.username ?? ""}
                onChange={(v) => setField("username", v)}
                placeholder="Select user…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            <OperationToggle />
            <div className="space-y-1.5">
              <Label>Role</Label>
              <LazySelect
                value={form.role ?? ""}
                onChange={(v) => setField("role", v)}
                placeholder="Select role…"
                state={roles}
                onOpen={ensureRoles}
              />
            </div>
            {form.username && form.operation && form.role && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">{form.operation} {form.role} {grantRevokeTarget(form.operation)} {form.username};</code>
              </p>
            )}
          </div>
        );

      case "bulk_object_privilege":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Grantee (Username)</Label>
              <LazySelect
                value={form.username ?? ""}
                onChange={(v) => setField("username", v)}
                placeholder="Select user…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            <OperationToggle />
            <div className="space-y-1.5">
              <Label>Object Owner</Label>
              <LazySelect
                value={form.owner_name ?? ""}
                onChange={(v) => {
                  setField("owner_name", v);
                  setSelectedObjectNames([]);
                  setAllObjectsSelected(false);
                  loadObjects(v);
                }}
                placeholder="Select owner…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            {form.owner_name && (
              <label className="flex items-start gap-2 cursor-pointer rounded-md border border-border/60 p-2.5">
                <input
                  type="checkbox"
                  checked={allObjectsSelected}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllObjectsSelected(checked);
                    if (checked) {
                      if (!objects.loaded && !objects.loading) loadObjects(form.owner_name);
                      setSelectedObjectNames(objects.items);
                    }
                  }}
                  className="h-4 w-4 mt-0.5 accent-cyan-500"
                />
                <span className="text-xs text-muted-foreground">
                  {form.operation === "REVOKE" ? "Revoke" : "Grant"} on <strong className="text-foreground">all objects</strong> owned by {form.owner_name}
                </span>
              </label>
            )}
            {!allObjectsSelected && (
              <SearchableMultiObjectSelect
                selected={selectedObjectNames}
                onChange={setSelectedObjectNames}
                placeholder={form.owner_name ? "Search and select objects…" : "Select owner first…"}
                state={objects}
                onOpen={() => { if (form.owner_name) loadObjects(form.owner_name); }}
              />
            )}
            {objects.loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading objects…
              </p>
            )}
            {bulkPrivValidation.isIncompatible && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2.5 text-xs text-amber-300">
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-200">Incompatible Object Types Selected</p>
                  <p className="mt-0.5 text-amber-300/80 leading-relaxed">
                    You have selected objects of types: <strong className="font-mono text-amber-200">{bulkPrivValidation.selectedTypes.join(", ")}</strong>. These object types do not share any common Oracle privileges (e.g. Table vs Procedure). Please select objects of compatible types.
                  </p>
                </div>
              </div>
            )}
            <MultiPrivilegeSelector
              options={OBJECT_PRIVILEGES}
              selected={selectedObjPrivs as typeof OBJECT_PRIVILEGES[number][]}
              onChange={setSelectedObjPrivs as (items: typeof OBJECT_PRIVILEGES[number][]) => void}
              disabledOptions={bulkPrivValidation.disabledPrivilegeReasons}
              label="Object Privileges"
            />
            {form.username && form.operation && form.owner_name && (allObjectsSelected || selectedObjectNames.length > 0) && selectedObjPrivs.length > 0 && !bulkPrivValidation.isIncompatible && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">
                  {form.operation} {selectedObjPrivs.join(", ")} ON {form.owner_name}.
                  {allObjectsSelected ? "*" : selectedObjectNames.join(", ")}{" "}
                  {grantRevokeTarget(form.operation)} {form.username};
                </code>
              </p>
            )}
          </div>
        );

      case "grant_sys_privs_role":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <LazySelect
                value={form.role ?? ""}
                onChange={(v) => setField("role", v)}
                placeholder="Select role…"
                state={roles}
                onOpen={ensureRoles}
              />
            </div>
            <OperationToggle />
            <MultiPrivilegeSelector
              options={SYSTEM_PRIVILEGES}
              selected={selectedSysPrivs as typeof SYSTEM_PRIVILEGES[number][]}
              onChange={setSelectedSysPrivs as (items: typeof SYSTEM_PRIVILEGES[number][]) => void}
              label="System Privileges"
            />
            {form.role && form.operation && selectedSysPrivs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">{form.operation} {selectedSysPrivs.join(", ")} {grantRevokeTarget(form.operation)} {form.role};</code>
              </p>
            )}
          </div>
        );

      case "grant_obj_privs_role":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role (Grantee)</Label>
              <LazySelect
                value={form.role ?? ""}
                onChange={(v) => setField("role", v)}
                placeholder="Select role…"
                state={roles}
                onOpen={ensureRoles}
              />
            </div>
            <OperationToggle />
            <div className="space-y-1.5">
              <Label>Object Owner</Label>
              <LazySelect
                value={form.owner_name ?? ""}
                onChange={(v) => {
                  setField("owner_name", v);
                  setField("object_name", "");
                  loadObjects(v);
                }}
                placeholder="Select owner…"
                state={schemas}
                onOpen={ensureSchemas}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Object Name</Label>
              <SearchableObjectSelect
                value={form.object_name ?? ""}
                onChange={(v) => setField("object_name", v)}
                placeholder={form.owner_name ? "Search object…" : "Select owner first…"}
                state={objects}
                onOpen={() => { if (form.owner_name) loadObjects(form.owner_name); }}
              />
            </div>
            <MultiPrivilegeSelector
              options={OBJECT_PRIVILEGES}
              selected={selectedObjPrivs as typeof OBJECT_PRIVILEGES[number][]}
              onChange={setSelectedObjPrivs as (items: typeof OBJECT_PRIVILEGES[number][]) => void}
              disabledOptions={singleObjectValidation.disabledPrivilegeReasons}
              label="Object Privileges"
            />
            {form.role && form.operation && form.owner_name && form.object_name && selectedObjPrivs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">{form.operation} {selectedObjPrivs.join(", ")} ON {form.owner_name}.{form.object_name} {grantRevokeTarget(form.operation)} {form.role};</code>
              </p>
            )}
          </div>
        );

      case "drop_role":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <LazySelect
                value={form.role ?? ""}
                onChange={(v) => setField("role", v)}
                placeholder="Select role…"
                state={roles}
                onOpen={ensureRoles}
              />
            </div>
            {form.role && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-1">
                <p className="text-sm font-medium text-red-400">Destructive Operation</p>
                <p className="text-xs text-muted-foreground">
                  n8n will execute: <code className="text-red-400">DROP ROLE {form.role};</code>
                  <br />The role and its privilege grants will be permanently removed.
                </p>
                <p className="text-[11px] text-amber-300/90 pt-1 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  On production databases (PROD/DR), this action requires App Administrator approval before execution.
                </p>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Action cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PRIV_CARDS.map(({ modal, label, description, icon: Icon, tone, destructive }) => (
          <Card
            key={modal}
            className={cn(
              "group relative cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
              destructive ? "hover:border-red-400/40 hover:shadow-red-500/10" : TONE_STYLES[tone].hover
            )}
            onClick={() => openModal(modal)}
          >
            <CardContent className="flex h-full flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "rounded-lg border p-2 transition-transform duration-200 group-hover:scale-110",
                    destructive ? "border-red-400/30 bg-red-400/10 text-red-300" : TONE_STYLES[tone].chip
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {destructive ? (
                  <Badge variant="outline" className="border-red-400/40 text-[10px] text-red-400">Destructive</Badge>
                ) : (
                  <ArrowRight
                    className={cn(
                      "h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100",
                      TONE_STYLES[tone].arrow
                    )}
                  />
                )}
              </div>
              <div className="mt-3 flex-1">
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Check User Privileges Result */}
      {checkPrivsResult && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold">User Privileges Report</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
              onClick={() => {
                setCheckPrivsResult(null);
                try {
                  sessionStorage.removeItem("user_mgmt_check_privileges");
                } catch {}
              }}
            >
              Clear
            </Button>
          </div>
          <ResultPanel result={checkPrivsResult} error={null} />
        </div>
      )}

      {/* Modal */}
      <Dialog open={!!activeModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className={modalStep === "result" ? "sm:max-w-4xl lg:max-w-5xl max-h-[90vh] flex flex-col overflow-hidden transition-all" : "max-w-lg max-h-[90vh] flex flex-col"}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {getModalTitle()}
              <span className="text-xs text-muted-foreground font-normal">— {selectedDb}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1 py-2">
            {modalStep === "form" ? renderFormContent() : <ResultPanel result={modalResult} error={modalError} />}
          </div>

          <DialogFooter className="shrink-0 pt-3 border-t border-border/40">
            {modalStep === "form" ? (
              <>
                <Button variant="outline" onClick={closeModal} disabled={executing}>Cancel</Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitDisabled()}
                  variant={activeModal === "drop_role" ? "destructive" : "default"}
                >
                  {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {activeModal === "check_privileges" ? "Check Privileges" : "Execute"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setModalStep("form"); setForm({}); setSelectedSysPrivs([]); setSelectedObjPrivs([]); setSelectedObjectNames([]); setAllObjectsSelected(false); }}>New Action</Button>
                <Button onClick={closeModal}>Done</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
