"use client";

import { useCallback, useRef, useState } from "react";
import {
  CheckCircle2,
  Database,
  DatabaseZap,
  Fingerprint,
  HardDrive,
  KeyRound,
  Loader2,
  LockOpen,
  UserCheck,
  UserPen,
  UserPlus,
  UserX,
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
import { useUserMgmt } from "@/hooks/use-user-mgmt";
import type { DbaResponse, UserStatusRow } from "@/types/dba";

/* ── Types ─────────────────────────────────────────────── */

type AccountModal =
  | "user_status"
  | "create_user"
  | "unlock_user"
  | "reset_password"
  | "change_default_tbs"
  | "change_temp_tbs"
  | "change_quota"
  | "assign_profile"
  | "rename_user"
  | "drop_user"
  | null;

type ModalStep = "form" | "result";

interface DropdownState {
  items: string[];
  loading: boolean;
  loaded: boolean;
}

const emptyDropdown = (): DropdownState => ({ items: [], loading: false, loaded: false });

/* ── Action card definitions ────────────────────────────── */

const ACCOUNT_CARDS: {
  modal: AccountModal;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  destructive?: boolean;
  noSchemaLoad?: boolean;
}[] = [
  {
    modal: "user_status",
    label: "Check Users Status",
    description: "View account status, expiry date, and profile for all users.",
    icon: UserCheck,
    noSchemaLoad: true
  },
  {
    modal: "create_user",
    label: "Create User",
    description: "Create a new Oracle user with tablespace, profile, and quota.",
    icon: UserPlus,
    noSchemaLoad: true
  },
  {
    modal: "unlock_user",
    label: "Unlock User",
    description: "Unlock a locked database account.",
    icon: LockOpen
  },
  {
    modal: "reset_password",
    label: "Reset Password",
    description: "Set a new password for an existing user.",
    icon: KeyRound
  },
  {
    modal: "change_default_tbs",
    label: "Change Default Tablespace",
    description: "Reassign the user's default permanent tablespace.",
    icon: Database
  },
  {
    modal: "change_temp_tbs",
    label: "Change Temporary Tablespace",
    description: "Reassign the user's temporary tablespace.",
    icon: DatabaseZap
  },
  {
    modal: "change_quota",
    label: "Change Quota",
    description: "Alter storage quota on a tablespace for a user.",
    icon: HardDrive
  },
  {
    modal: "assign_profile",
    label: "Assign Profile",
    description: "Assign an Oracle profile to a user.",
    icon: Fingerprint
  },
  {
    modal: "rename_user",
    label: "Rename User",
    description: "Rename an Oracle user (ALTER USER … RENAME TO).",
    icon: UserPen
  },
  {
    modal: "drop_user",
    label: "Drop User",
    description: "Permanently drop a user and all owned objects (CASCADE).",
    icon: UserX,
    destructive: true
  }
];

/* ── Result Panel ────────────────────────────────────────── */

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  const str = String(val);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    }
  }
  return str;
}

function ResultPanel({ result, error }: { result: DbaResponse | null; error: string | null }) {
  const isError = error || result?.status === "error";
  const summary = result?.ai_summary || error || "";

  const rows = ((result?.raw_data?.rows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(row)) normalized[key.toLowerCase()] = row[key];
    return normalized;
  });

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
        <div className="rounded-lg border border-border/60 overflow-x-auto">
          <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/60">
            Confirmation Query Result
          </p>
          <table className="min-w-full text-sm">
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
                <tr key={i} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                  {Object.values(row).map((val, j) => (
                    <td key={j} className="px-4 py-2 font-mono text-xs whitespace-nowrap">{formatCellValue(val)}</td>
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

/* ── Lazy Dropdown ───────────────────────────────────────── */

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

/* ── Main Section ────────────────────────────────────────── */

export function UserAccountSection() {
  const { execute, loadDropdown, executing, selectedDb } = useUserMgmt();

  const [activeModal, setActiveModal] = useState<AccountModal>(null);
  const [modalStep, setModalStep] = useState<ModalStep>("form");
  const [modalResult, setModalResult] = useState<DbaResponse | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<Record<string, string>>({});

  // Dropdown caches
  const [schemas, setSchemas] = useState<DropdownState>(emptyDropdown);
  const [tbs, setTbs] = useState<DropdownState>(emptyDropdown);
  const [tempTbs, setTempTbs] = useState<DropdownState>(emptyDropdown);
  const [profiles, setProfiles] = useState<DropdownState>(emptyDropdown);

  const loadingRef = useRef<Record<string, boolean>>({});

  const loadOnce = useCallback(
    async (
      key: string,
      action: Parameters<typeof loadDropdown>[0],
      params: Record<string, unknown>,
      setter: (s: DropdownState) => void,
      columnHint?: string
    ) => {
      if (loadingRef.current[key]) return;
      loadingRef.current[key] = true;
      setter({ items: [], loading: true, loaded: false });
      const items = await loadDropdown(action, params, columnHint);
      setter({ items, loading: false, loaded: true });
      loadingRef.current[key] = false;
    },
    [loadDropdown]
  );

  const ensureSchemas = useCallback(() => {
    if (!schemas.loaded && !schemas.loading) {
      loadOnce("schemas", "schema_list", {}, setSchemas, "username");
    }
  }, [schemas.loaded, schemas.loading, loadOnce]);

  const ensureTbs = useCallback(() => {
    if (!tbs.loaded && !tbs.loading) {
      loadOnce("tbs", "list_tbs", {}, setTbs, "tablespace_name");
    }
  }, [tbs.loaded, tbs.loading, loadOnce]);

  const ensureTempTbs = useCallback(() => {
    if (!tempTbs.loaded && !tempTbs.loading) {
      loadOnce("temptbs", "list_temp_tbs", {}, setTempTbs, "tablespace_name");
    }
  }, [tempTbs.loaded, tempTbs.loading, loadOnce]);

  const ensureProfiles = useCallback(() => {
    if (!profiles.loaded && !profiles.loading) {
      loadOnce("profiles", "list_profile", {}, setProfiles, "profile");
    }
  }, [profiles.loaded, profiles.loading, loadOnce]);

  const openModal = useCallback(
    (modal: AccountModal, needsSchema = true) => {
      setActiveModal(modal);
      setModalStep("form");
      setModalResult(null);
      setModalError(null);
      setForm({});
      if (needsSchema) ensureSchemas();
    },
    [ensureSchemas]
  );

  const closeModal = () => {
    setActiveModal(null);
    setModalStep("form");
    setModalResult(null);
    setModalError(null);
    setForm({});
  };

  const setField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    try {
      let res: DbaResponse;
      switch (activeModal) {
        case "user_status":
          res = await execute("user_status", {});
          setStatusResult(res);
          closeModal();
          return;
        case "create_user":
          res = await execute("create_user", {
            username: form.username,
            password: form.password,
            default_tablespace: form.default_tablespace || undefined,
            temp_tablespace: form.temp_tablespace || undefined,
            profile: form.profile || undefined,
            quota: form.quota || undefined
          });
          break;
        case "unlock_user":
          res = await execute("unlock_user", { username: form.username });
          break;
        case "reset_password":
          res = await execute("reset_password", { username: form.username, password: form.password });
          break;
        case "change_default_tbs":
          res = await execute("change_default_tbs", { username: form.username, tablespace: form.tablespace });
          break;
        case "change_temp_tbs":
          res = await execute("change_temp_tbs", { username: form.username, tablespace: form.tablespace });
          break;
        case "change_quota":
          res = await execute("change_quota", { username: form.username, tablespace: form.tablespace, quota: form.quota });
          break;
        case "assign_profile":
          res = await execute("assign_profile", { username: form.username, profile: form.profile });
          break;
        case "rename_user":
          res = await execute("rename_user", { username: form.username, new_username: form.new_username });
          break;
        case "drop_user":
          res = await execute("drop_user", { username: form.username });
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
      case "user_status": return false;
      case "create_user": return !form.username || !form.password;
      case "unlock_user": return !form.username;
      case "reset_password": return !form.username || !form.password;
      case "change_default_tbs": return !form.username || !form.tablespace;
      case "change_temp_tbs": return !form.username || !form.tablespace;
      case "change_quota": return !form.username || !form.tablespace || !form.quota;
      case "assign_profile": return !form.username || !form.profile;
      case "rename_user": return !form.username || !form.new_username;
      case "drop_user": return !form.username;
      default: return true;
    }
  };

  const getModalTitle = (): string => {
    const card = ACCOUNT_CARDS.find((c) => c.modal === activeModal);
    return card?.label ?? "";
  };

  /* ── Form renderers ────────── */

  const renderUserSelect = (label = "Username") => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <LazySelect
        value={form.username ?? ""}
        onChange={(v) => setField("username", v)}
        placeholder="Select user…"
        state={schemas}
        onOpen={ensureSchemas}
      />
    </div>
  );

  const renderTbsSelect = (fieldKey = "tablespace", label = "Tablespace") => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <LazySelect
        value={form[fieldKey] ?? ""}
        onChange={(v) => setField(fieldKey, v)}
        placeholder="Select tablespace…"
        state={tbs}
        onOpen={ensureTbs}
      />
    </div>
  );

  const renderTempTbsSelect = () => (
    <div className="space-y-1.5">
      <Label>Temporary Tablespace <span className="text-muted-foreground">(optional)</span></Label>
      <LazySelect
        value={form.temp_tablespace ?? ""}
        onChange={(v) => setField("temp_tablespace", v)}
        placeholder="Select temp tablespace…"
        state={tempTbs}
        onOpen={ensureTempTbs}
      />
    </div>
  );

  const renderProfileSelect = (optional = false) => (
    <div className="space-y-1.5">
      <Label>Profile {optional && <span className="text-muted-foreground">(optional)</span>}</Label>
      <LazySelect
        value={form.profile ?? ""}
        onChange={(v) => setField("profile", v)}
        placeholder="Select profile…"
        state={profiles}
        onOpen={ensureProfiles}
      />
    </div>
  );

  const renderFormContent = () => {
    switch (activeModal) {
      case "user_status":
        return (
          <p className="text-sm text-muted-foreground">
            Sends <code className="text-cyan-400">user_status</code> to n8n, which will return the account status, expiry date, and profile for all DBA users.
          </p>
        );

      case "create_user":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Username <span className="text-red-400">*</span></Label>
                <Input value={form.username ?? ""} onChange={(e) => setField("username", e.target.value)} placeholder="APP_USER" className="uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label>Password <span className="text-red-400">*</span></Label>
                <Input type="password" value={form.password ?? ""} onChange={(e) => setField("password", e.target.value)} placeholder="••••••••" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Default Tablespace <span className="text-muted-foreground">(optional)</span></Label>
              <LazySelect
                value={form.default_tablespace ?? ""}
                onChange={(v) => setField("default_tablespace", v)}
                placeholder="Select tablespace…"
                state={tbs}
                onOpen={ensureTbs}
              />
            </div>
            {renderTempTbsSelect()}
            {renderProfileSelect(true)}
            <div className="space-y-1.5">
              <Label>Quota <span className="text-muted-foreground">(optional, e.g. 500M, 1G, UNLIMITED)</span></Label>
              <Input value={form.quota ?? ""} onChange={(e) => setField("quota", e.target.value)} placeholder="500M" />
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              n8n will execute: <code className="text-cyan-400">CREATE USER {form.username || "…"} IDENTIFIED BY &quot;…&quot;</code>
            </p>
          </div>
        );

      case "unlock_user":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            {form.username && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} ACCOUNT UNLOCK;</code>
              </p>
            )}
          </div>
        );

      case "reset_password":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            <div className="space-y-1.5">
              <Label>New Password <span className="text-red-400">*</span></Label>
              <Input type="password" value={form.password ?? ""} onChange={(e) => setField("password", e.target.value)} placeholder="••••••••" />
            </div>
            {form.username && form.password && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} IDENTIFIED BY &quot;…&quot;;</code>
              </p>
            )}
          </div>
        );

      case "change_default_tbs":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            {renderTbsSelect("tablespace", "New Default Tablespace")}
            {form.username && form.tablespace && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} DEFAULT TABLESPACE {form.tablespace};</code>
              </p>
            )}
          </div>
        );

      case "change_temp_tbs":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            <div className="space-y-1.5">
              <Label>New Temporary Tablespace</Label>
              <LazySelect
                value={form.tablespace ?? ""}
                onChange={(v) => setField("tablespace", v)}
                placeholder="Select temp tablespace…"
                state={tempTbs}
                onOpen={ensureTempTbs}
              />
            </div>
            {form.username && form.tablespace && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} TEMPORARY TABLESPACE {form.tablespace};</code>
              </p>
            )}
          </div>
        );

      case "change_quota":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            {renderTbsSelect("tablespace", "Tablespace")}
            <div className="space-y-1.5">
              <Label>Quota Size <span className="text-red-400">*</span></Label>
              <Input value={form.quota ?? ""} onChange={(e) => setField("quota", e.target.value)} placeholder="e.g. 1G, 500M, UNLIMITED" />
            </div>
            {form.username && form.tablespace && form.quota && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} QUOTA {form.quota} ON {form.tablespace};</code>
              </p>
            )}
          </div>
        );

      case "assign_profile":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            {renderProfileSelect()}
            {form.username && form.profile && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} PROFILE {form.profile};</code>
              </p>
            )}
          </div>
        );

      case "rename_user":
        return (
          <div className="space-y-4">
            {renderUserSelect("Current Username")}
            <div className="space-y-1.5">
              <Label>New Username <span className="text-red-400">*</span></Label>
              <Input value={form.new_username ?? ""} onChange={(e) => setField("new_username", e.target.value)} placeholder="NEW_APP_USER" className="uppercase" />
            </div>
            {form.username && form.new_username && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER USER {form.username} RENAME TO {form.new_username};</code>
              </p>
            )}
          </div>
        );

      case "drop_user":
        return (
          <div className="space-y-4">
            {renderUserSelect()}
            {form.username && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-1">
                <p className="text-sm font-medium text-red-400">Destructive Operation</p>
                <p className="text-xs text-muted-foreground">
                  n8n will execute: <code className="text-red-400">DROP USER {form.username} CASCADE;</code>
                  <br />All objects owned by this user will be permanently deleted.
                </p>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  /* ── User Status inline result ── */
  const [statusResult, setStatusResult] = useState<DbaResponse | null>(null);
  const statusRows = ((statusResult?.raw_data?.rows ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(row)) normalized[key.toLowerCase()] = row[key];
      return normalized as unknown as UserStatusRow;
    }
  );

  /* ── Render ─────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Action cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {ACCOUNT_CARDS.map(({ modal, label, description, icon: Icon, destructive, noSchemaLoad }) => (
          <Card key={modal} className="hover:border-border/80 transition-colors cursor-pointer group" onClick={() => openModal(modal, !noSchemaLoad)}>
            <CardContent className="flex flex-col p-4 h-full">
              <div className="flex items-start justify-between gap-2">
                <span className={`rounded-md border p-2 ${destructive ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"} group-hover:scale-105 transition-transform`}>
                  <Icon className="h-4 w-4" />
                </span>
                {destructive && <Badge variant="outline" className="text-red-400 border-red-400/40 text-[10px]">Destructive</Badge>}
              </div>
              <div className="mt-3 flex-1">
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* User Status result table (below cards, outside modal) */}
      {statusRows.length > 0 && (
        <div className="rounded-lg border border-border/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <p className="text-sm font-semibold">All Database Users — Account Status</p>
            <Button variant="ghost" size="sm" onClick={() => setStatusResult(null)}>Clear</Button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  {["Username", "Account Status", "Expiry Date", "Profile"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row, i) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs font-medium">{row.username}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          row.account_status === "OPEN"
                            ? "text-emerald-400 border-emerald-400/40"
                            : row.account_status === "LOCKED"
                            ? "text-amber-400 border-amber-400/40"
                            : "text-red-400 border-red-400/40"
                        }`}
                      >
                        {row.account_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {row.expiry_date
                        ? new Date(row.expiry_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{row.profile}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main action modal — user_status closes immediately after result, others show result step */}
      <Dialog open={!!activeModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className={modalStep === "result" ? "w-[90vw] max-w-5xl" : "max-w-lg"}>
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
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitDisabled()}
                  variant={activeModal === "drop_user" ? "destructive" : "default"}
                >
                  {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {activeModal === "user_status" ? "Fetch Status" : "Execute"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setModalStep("form"); setForm({}); }}>New Action</Button>
                <Button onClick={closeModal}>Done</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
