"use client";

import { useCallback, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  FileEdit,
  FilePlus,
  FileX,
  Loader2,
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
import type { DbaResponse, ProfileParameterRow } from "@/types/dba";

/* ── Types ─────────────────────────────────────────── */

type ProfileModal = "view_profiles" | "create_profile" | "alter_profile" | "drop_profile" | null;
type ModalStep = "form" | "result";

interface DropdownState {
  items: string[];
  loading: boolean;
  loaded: boolean;
}

const emptyDropdown = (): DropdownState => ({ items: [], loading: false, loaded: false });

/* ── Constants ─────────────────────────────────────── */

const RESOURCE_NAMES = [
  "SESSIONS_PER_USER",
  "IDLE_TIME",
  "CONNECT_TIME",
  "CPU_PER_SESSION",
  "LOGICAL_READS_PER_SESSION",
  "PASSWORD_LIFE_TIME",
  "FAILED_LOGIN_ATTEMPTS",
  "PASSWORD_GRACE_TIME",
  "PASSWORD_REUSE_TIME",
  "PASSWORD_LOCK_TIME",
  "PASSWORD_VERIFY_FUNCTION"
] as const;

type ProfileParam = {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
};

const CREATE_PROFILE_PARAMS: ProfileParam[] = [
  { key: "SESSIONS_PER_USER", label: "Sessions Per User", placeholder: "3" },
  { key: "CPU_PER_SESSION", label: "CPU Per Session", placeholder: "UNLIMITED" },
  { key: "CPU_PER_CALL", label: "CPU Per Call", placeholder: "UNLIMITED" },
  { key: "CONNECT_TIME", label: "Connect Time (mins)", placeholder: "480" },
  { key: "IDLE_TIME", label: "Idle Time (mins)", placeholder: "30" },
  { key: "LOGICAL_READS_PER_SESSION", label: "Logical Reads / Session", placeholder: "UNLIMITED" },
  { key: "LOGICAL_READS_PER_CALL", label: "Logical Reads / Call", placeholder: "UNLIMITED" },
  { key: "PRIVATE_SGA", label: "Private SGA", placeholder: "UNLIMITED" },
  { key: "COMPOSITE_LIMIT", label: "Composite Limit", placeholder: "UNLIMITED" },
  { key: "FAILED_LOGIN_ATTEMPTS", label: "Failed Login Attempts", placeholder: "5" },
  { key: "PASSWORD_LIFE_TIME", label: "Password Life Time (days)", placeholder: "90" },
  { key: "PASSWORD_GRACE_TIME", label: "Password Grace Time (days)", placeholder: "7" },
  { key: "PASSWORD_REUSE_TIME", label: "Password Reuse Time (days)", placeholder: "365" },
  { key: "PASSWORD_REUSE_MAX", label: "Password Reuse Max", placeholder: "5" },
  { key: "PASSWORD_VERIFY_FUNCTION", label: "Password Verify Function", placeholder: "ora12c_verify_function", hint: "Use NULL to disable" },
  { key: "PASSWORD_LOCK_TIME", label: "Password Lock Time (days)", placeholder: "1" },
  { key: "PASSWORD_ROLLOVER_TIME", label: "Password Rollover Time (days)", placeholder: "1" },
  { key: "INACTIVE_ACCOUNT_TIME", label: "Inactive Account Time (days)", placeholder: "90" }
];

/* ── Profile Cards ─────────────────────────────────── */

const PROFILE_CARDS = [
  {
    modal: "view_profiles" as ProfileModal,
    label: "View All Profile Parameters",
    description: "Query DBA_PROFILES for all resource and password parameters.",
    icon: ClipboardList
  },
  {
    modal: "create_profile" as ProfileModal,
    label: "Create Profile",
    description: "Create a new Oracle profile with custom resource and password limits.",
    icon: FilePlus
  },
  {
    modal: "alter_profile" as ProfileModal,
    label: "Alter Profile",
    description: "Modify a specific resource or password parameter on an existing profile.",
    icon: FileEdit
  },
  {
    modal: "drop_profile" as ProfileModal,
    label: "Drop Profile",
    description: "Permanently remove an Oracle profile from the database.",
    icon: FileX,
    destructive: true
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

/* ── Main Section ──────────────────────────────────── */

export function ProfileManagementSection() {
  const { execute, loadDropdown, executing, selectedDb } = useUserMgmt();

  const [activeModal, setActiveModal] = useState<ProfileModal>(null);
  const [modalStep, setModalStep] = useState<ModalStep>("form");
  const [modalResult, setModalResult] = useState<DbaResponse | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, string>>({});
  const [profileDropdown, setProfileDropdown] = useState<DropdownState>(emptyDropdown);

  // View profiles inline result
  const [viewProfilesResult, setViewProfilesResult] = useState<DbaResponse | null>(null);

  const loadingRef = useRef<Record<string, boolean>>({});

  const ensureProfiles = useCallback(async () => {
    if (profileDropdown.loaded || profileDropdown.loading || loadingRef.current["profiles"]) return;
    loadingRef.current["profiles"] = true;
    setProfileDropdown({ items: [], loading: true, loaded: false });
    const items = await loadDropdown("list_profile", {}, "profile");
    setProfileDropdown({ items, loading: false, loaded: true });
    loadingRef.current["profiles"] = false;
  }, [profileDropdown.loaded, profileDropdown.loading, loadDropdown]);

  const setField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openModal = (modal: ProfileModal) => {
    setActiveModal(modal);
    setModalStep("form");
    setModalResult(null);
    setModalError(null);
    setForm({});
    if (modal === "alter_profile" || modal === "drop_profile") {
      ensureProfiles();
    }
  };

  const closeModal = () => {
    setActiveModal(null);
    setModalStep("form");
    setModalResult(null);
    setModalError(null);
    setForm({});
  };

  const handleSubmit = async () => {
    try {
      let res: DbaResponse;
      switch (activeModal) {
        case "view_profiles":
          res = await execute("view_profiles", {});
          setViewProfilesResult(res);
          closeModal();
          return;
        case "create_profile": {
          const params: Record<string, string> = { profile_name: form.profile_name };
          CREATE_PROFILE_PARAMS.forEach(({ key }) => {
            if (form[key]) params[key] = form[key];
          });
          res = await execute("create_profile", params);
          break;
        }
        case "alter_profile":
          res = await execute("alter_profile", {
            profile_name: form.profile_name,
            resource_name: form.resource_name,
            limit: form.limit
          });
          break;
        case "drop_profile":
          res = await execute("drop_profile", { profile_name: form.profile_name });
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
      case "view_profiles": return false;
      case "create_profile": return !form.profile_name;
      case "alter_profile": return !form.profile_name || !form.resource_name || !form.limit;
      case "drop_profile": return !form.profile_name;
      default: return true;
    }
  };

  const getModalTitle = () => PROFILE_CARDS.find((c) => c.modal === activeModal)?.label ?? "";

  const renderFormContent = () => {
    switch (activeModal) {
      case "view_profiles":
        return (
          <p className="text-sm text-muted-foreground">
            Queries <code className="text-cyan-400">DBA_PROFILES</code> for all profiles with resource and password parameters. Result will appear below the section cards.
          </p>
        );

      case "create_profile":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Profile Name <span className="text-red-400">*</span></Label>
              <Input
                value={form.profile_name ?? ""}
                onChange={(e) => setField("profile_name", e.target.value)}
                placeholder="APP_PROFILE"
                className="uppercase"
              />
            </div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Profile Parameters (leave blank to use Oracle defaults)</p>
            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
              {CREATE_PROFILE_PARAMS.map(({ key, label, placeholder, hint }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
                  <Input
                    value={form[key] ?? ""}
                    onChange={(e) => setField(key, e.target.value)}
                    placeholder={placeholder}
                    className="text-xs h-8"
                  />
                </div>
              ))}
            </div>
          </div>
        );

      case "alter_profile":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Profile Name</Label>
              <LazySelect
                value={form.profile_name ?? ""}
                onChange={(v) => setField("profile_name", v)}
                placeholder="Select profile…"
                state={profileDropdown}
                onOpen={ensureProfiles}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Resource Name</Label>
              <Select value={form.resource_name ?? ""} onValueChange={(v) => setField("resource_name", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select resource…" />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_NAMES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Limit Value <span className="text-red-400">*</span></Label>
              <Input
                value={form.limit ?? ""}
                onChange={(e) => setField("limit", e.target.value)}
                placeholder="e.g. 5, 90, UNLIMITED, DEFAULT"
              />
            </div>
            {form.profile_name && form.resource_name && form.limit && (
              <p className="text-xs text-muted-foreground">
                n8n will execute: <code className="text-cyan-400">ALTER PROFILE {form.profile_name} LIMIT {form.resource_name} {form.limit};</code>
              </p>
            )}
          </div>
        );

      case "drop_profile":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Profile Name</Label>
              <LazySelect
                value={form.profile_name ?? ""}
                onChange={(v) => setField("profile_name", v)}
                placeholder="Select profile…"
                state={profileDropdown}
                onOpen={ensureProfiles}
              />
            </div>
            {form.profile_name && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-sm font-medium text-red-400">Destructive Operation</p>
                <p className="text-xs text-muted-foreground mt-1">
                  n8n will execute: <code className="text-red-400">DROP PROFILE {form.profile_name};</code>
                </p>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  /* ── View Profiles Result Table ── */
  const [profileFilter, setProfileFilter] = useState<string>("__all");

  const profileRows = ((viewProfilesResult?.raw_data?.rows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(row)) normalized[key.toLowerCase()] = row[key];
    return normalized as unknown as ProfileParameterRow;
  });

  const allProfileNames = Array.from(new Set(profileRows.map((r) => r.profile))).sort();

  const filteredProfileRows = profileFilter === "__all"
    ? profileRows
    : profileRows.filter((r) => r.profile === profileFilter);

  const profileGroups = filteredProfileRows.reduce<Record<string, ProfileParameterRow[]>>((acc, row) => {
    const key = row.profile;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Action cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PROFILE_CARDS.map(({ modal, label, description, icon: Icon, destructive }) => (
          <Card
            key={modal}
            className="hover:border-border/80 transition-colors cursor-pointer group"
            onClick={() => openModal(modal)}
          >
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

      {/* View Profiles Result */}
      {profileRows.length > 0 && (
        <div className="rounded-lg border border-border/60">
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border/60">
            <p className="text-sm font-semibold shrink-0">Profile Parameters</p>
            <div className="flex items-center gap-3 min-w-0">
              <Select
                value={profileFilter}
                onValueChange={(v) => setProfileFilter(v)}
              >
                <SelectTrigger className="h-8 text-xs w-56">
                  <SelectValue placeholder="Filter by profile…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All profiles ({allProfileNames.length})</SelectItem>
                  {allProfileNames.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => { setViewProfilesResult(null); setProfileFilter("__all"); }}>Clear</Button>
            </div>
          </div>
          <div className="overflow-auto">
            {Object.keys(profileGroups).length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No parameters match the selected profile.</p>
            ) : (
              Object.entries(profileGroups).map(([profileName, rows]) => (
                <div key={profileName}>
                  <div className="px-4 py-2 bg-muted/30 border-b border-border/40">
                    <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">{profileName}</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Resource / Parameter</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                          <td className="px-4 py-2 font-mono text-xs">{row.resource_name}</td>
                          <td className="px-4 py-2 font-mono text-xs text-cyan-300">{row.limit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal */}
      <Dialog open={!!activeModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-w-xl">
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
                  variant={activeModal === "drop_profile" ? "destructive" : "default"}
                >
                  {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {activeModal === "view_profiles" ? "Fetch Profiles" : "Execute"}
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
