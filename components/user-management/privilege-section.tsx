"use client";

import { useCallback, useRef, useState } from "react";
import {
  BadgeCheck,
  BadgePlus,
  CheckCircle2,
  Loader2,
  Shield,
  ShieldAlert,
  XCircle
} from "lucide-react";
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
import { useUserMgmt } from "@/hooks/use-user-mgmt";
import type { DbaResponse } from "@/types/dba";

/* ── Types ─────────────────────────────────────────── */

type PrivModal =
  | "system_privilege"
  | "object_privilege"
  | "create_role"
  | "role_to_user"
  | null;

type ModalStep = "form" | "result";

interface DropdownState {
  items: string[];
  loading: boolean;
  loaded: boolean;
}

const emptyDropdown = (): DropdownState => ({ items: [], loading: false, loaded: false });

/* ── Constants ─────────────────────────────────────── */

const SYSTEM_PRIVILEGES = [
  "CREATE SESSION",
  "CREATE TABLE",
  "CREATE VIEW",
  "CREATE PROCEDURE",
  "CREATE USER",
  "ALTER USER",
  "DROP USER",
  "ALTER SYSTEM",
  "SELECT ANY TABLE",
  "EXECUTE ANY PROCEDURE"
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

/** Oracle GRANT uses TO; REVOKE uses FROM. */
const grantRevokeTarget = (operation: string) =>
  operation === "REVOKE" ? "FROM" : "TO";

/* ── Privilege Cards ───────────────────────────────── */

const PRIV_CARDS = [
  {
    modal: "system_privilege" as PrivModal,
    label: "Grant / Revoke System Privileges",
    description: "Grant or revoke Oracle system-level privileges to/from a user.",
    icon: ShieldAlert
  },
  {
    modal: "object_privilege" as PrivModal,
    label: "Grant / Revoke Object Privileges",
    description: "Grant or revoke SELECT, INSERT, UPDATE, DELETE, EXECUTE on specific objects.",
    icon: Shield
  },
  {
    modal: "create_role" as PrivModal,
    label: "Create Role",
    description: "Create a new Oracle role to group privileges for easy assignment.",
    icon: BadgePlus
  },
  {
    modal: "role_to_user" as PrivModal,
    label: "Grant / Revoke Role",
    description: "Grant or revoke an Oracle role to/from a database user.",
    icon: BadgeCheck
  }
];

/* ── Result Panel ──────────────────────────────────── */

function ResultPanel({ result, error }: { result: DbaResponse | null; error: string | null }) {
  const isError = error || result?.status === "error";
  const rows = result?.raw_data?.rows ?? [];
  const summary = result?.ai_summary || error || "";

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-lg border p-4 ${isError ? "border-red-500/30 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
        {isError
          ? <XCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
          : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
        }
        <div className="min-w-0">
          <p className="font-medium text-sm">{isError ? "Action Failed" : "Action Succeeded"}</p>
          {summary && <p className="mt-1 text-sm text-muted-foreground">{summary}</p>}
        </div>
      </div>
      {rows.length > 0 && (
        <div className="rounded-lg border border-border/60 overflow-auto max-h-60">
          <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/60">
            Confirmation Query Result
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30">
                {Object.keys(rows[0]).map((col) => (
                  <th key={col} className="px-4 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    {col.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
                  {Object.values(row as Record<string, unknown>).map((val, j) => (
                    <td key={j} className="px-4 py-2 font-mono text-xs">{String(val ?? "—")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Lazy Dropdown ─────────────────────────────────── */

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
        {state.items.length === 0 && !state.loading && (
          <SelectItem value="__none" disabled>No data — open again to retry</SelectItem>
        )}
        {state.items.map((item) => (
          <SelectItem key={item} value={item}>{item}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── Multi-Checkbox select ─────────────────────────── */

function MultiPrivilegeSelector<T extends string>({
  options,
  selected,
  onChange,
  label
}: {
  options: readonly T[];
  selected: T[];
  onChange: (items: T[]) => void;
  label: string;
}) {
  const toggle = (item: T) => {
    if (selected.includes(item)) onChange(selected.filter((s) => s !== item));
    else onChange([...selected, item]);
  };

  return (
    <div className="space-y-1.5">
      <Label>{label} {selected.length > 0 && <span className="text-cyan-400 text-xs">({selected.length} selected)</span>}</Label>
      <div className="rounded-md border border-border/60 p-3 grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer group">
            <div
              className={`h-4 w-4 shrink-0 rounded border transition-colors ${selected.includes(opt) ? "border-cyan-400 bg-cyan-400/20" : "border-border/60"} flex items-center justify-center`}
              onClick={() => toggle(opt)}
            >
              {selected.includes(opt) && (
                <svg className="h-2.5 w-2.5 text-cyan-400" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-xs group-hover:text-foreground text-muted-foreground transition-colors" onClick={() => toggle(opt)}>{opt}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>Clear all</Button>
      )}
    </div>
  );
}

/* ── Main Section ──────────────────────────────────── */

export function PrivilegeManagementSection() {
  const { execute, loadDropdown, executing, selectedDb } = useUserMgmt();

  const [activeModal, setActiveModal] = useState<PrivModal>(null);
  const [modalStep, setModalStep] = useState<ModalStep>("form");
  const [modalResult, setModalResult] = useState<DbaResponse | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, string>>({});
  const [selectedSysPrivs, setSelectedSysPrivs] = useState<string[]>([]);
  const [selectedObjPrivs, setSelectedObjPrivs] = useState<string[]>([]);

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
    setObjects({ items: [], loading: true, loaded: false });
    const items = await loadDropdown("list_objects", { owner }, "object_name");
    setObjects({ items, loading: false, loaded: true });
    loadingRef.current["objects"] = false;
  }, [loadDropdown]);

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
    setObjects({ items: [], loading: false, loaded: false });
    if (modal !== "create_role") ensureSchemas();
    if (modal === "role_to_user") ensureRoles();
  };

  const closeModal = () => {
    setActiveModal(null);
    setModalStep("form");
    setModalResult(null);
    setModalError(null);
    setForm({});
    setSelectedSysPrivs([]);
    setSelectedObjPrivs([]);
  };

  const handleSubmit = async () => {
    try {
      let res: DbaResponse;
      switch (activeModal) {
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
      case "system_privilege":
        return !form.username || !form.operation || selectedSysPrivs.length === 0;
      case "object_privilege":
        return !form.username || !form.operation || !form.owner_name || !form.object_name || selectedObjPrivs.length === 0;
      case "create_role":
        return !form.role_name;
      case "role_to_user":
        return !form.username || !form.role || !form.operation;
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
              <LazySelect
                value={form.object_name ?? ""}
                onChange={(v) => setField("object_name", v)}
                placeholder={form.owner_name ? "Select object…" : "Select owner first…"}
                state={objects}
                onOpen={() => { if (form.owner_name) loadObjects(form.owner_name); }}
              />
            </div>
            <MultiPrivilegeSelector
              options={OBJECT_PRIVILEGES}
              selected={selectedObjPrivs as typeof OBJECT_PRIVILEGES[number][]}
              onChange={setSelectedObjPrivs as (items: typeof OBJECT_PRIVILEGES[number][]) => void}
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

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Action cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PRIV_CARDS.map(({ modal, label, description, icon: Icon }) => (
          <Card
            key={modal}
            className="hover:border-border/80 transition-colors cursor-pointer group"
            onClick={() => openModal(modal)}
          >
            <CardContent className="flex flex-col p-4 h-full">
              <div className="flex items-start gap-2">
                <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 p-2 group-hover:scale-105 transition-transform">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-3 flex-1">
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Modal */}
      <Dialog open={!!activeModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {getModalTitle()}
              <span className="text-xs text-muted-foreground font-normal">— {selectedDb}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-2">
            {modalStep === "form" ? renderFormContent() : <ResultPanel result={modalResult} error={modalError} />}
          </div>

          <DialogFooter>
            {modalStep === "form" ? (
              <>
                <Button variant="outline" onClick={closeModal} disabled={executing}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={isSubmitDisabled()}>
                  {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Execute
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setModalStep("form"); setForm({}); setSelectedSysPrivs([]); setSelectedObjPrivs([]); }}>New Action</Button>
                <Button onClick={closeModal}>Done</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
