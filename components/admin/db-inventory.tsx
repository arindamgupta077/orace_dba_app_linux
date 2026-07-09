"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseZap, Edit3, Loader2, Plus, Search, Trash2, UserRoundCog, SlidersHorizontal, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  changeDatabaseOwner,
  createDatabase,
  fetchDatabases,
  fetchUsersByRole,
  removeDatabase,
  updateDatabase
} from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { AppUser, DatabaseInventoryInput, DatabaseInventoryItem, DbDivision, DbEdition, DbEnvironment, DbOs, DbServerType, DbType } from "@/types/dba";
import { DB_DIVISION_OPTIONS, DB_EDITION_OPTIONS } from "@/types/dba";

const ENVIRONMENT_OPTIONS = ["Production", "non-production", "DR"];
const OS_OPTIONS: DbOs[] = ["Linux", "Windows"];
const ROLE_OPTIONS = ["Primary", "Standby", "Reporting"];
const DB_TYPE_OPTIONS: DbType[] = ["Standalone", "RAC", "Dataguard", "Active Dataguard"];
const STATUS_OPTIONS = ["active", "inactive", "decomissioned"];
const ENV_LABEL_OPTIONS: DbEnvironment[] = ["PROD", "DEV", "UAT", "DR"];
const LOCATION_OPTIONS = ["SDC", "KDC"];
const ZONE_OPTIONS = ["SZ1", "SZ2", "LAN"] as const;
const SERVER_TYPE_OPTIONS: DbServerType[] = ["Physical", "Virtual"];
const DIVISION_OPTIONS: DbDivision[] = DB_DIVISION_OPTIONS;
const DB_EDITION_OPTIONS_LIST: readonly DbEdition[] = DB_EDITION_OPTIONS;
const DEFAULT_DB_PORT = 1521;

interface InventoryFormState {
  database_name: string;
  environment: string;
  location: string;
  operating_system: string;
  database_role: string;
  database_type: string;
  status: string;
  environment_label: string;
  owner_id: string;
  server_name: string;
  server_ip: string;
  zone: string;
  server_type: string;
  db_version: string;
  db_edition: string;
  db_port: string;
  division: string;
}

const emptyForm: InventoryFormState = {
  database_name: "",
  environment: "Production",
  location: "SDC",
  operating_system: "Linux",
  database_role: "Primary",
  database_type: "Standalone",
  status: "active",
  environment_label: "PROD",
  owner_id: "",
  server_name: "",
  server_ip: "",
  zone: "SZ1",
  server_type: "Physical",
  db_version: "",
  db_edition: "Enterprise Edition",
  db_port: String(DEFAULT_DB_PORT),
  division: "PCPB"
};

function toForm(database: DatabaseInventoryItem): InventoryFormState {
  return {
    database_name: database.database_name,
    environment:
      database.environment === "production"
        ? "Production"
        : database.environment === "non-production"
          ? "non-production"
          : "DR",
    location: database.location,
    operating_system: database.os,
    database_role: database.role === "primary" ? "Primary" : database.role === "standby" ? "Standby" : "Reporting",
    database_type: database.db_type,
    status: database.status,
    environment_label: database.env_label,
    owner_id: String(database.owner_id),
    server_name: database.server_name || "",
    server_ip: database.server_ip || "",
    zone: database.zone || "SZ1",
    server_type: database.server_type,
    db_version: database.db_version || "",
    db_edition: database.db_edition || "",
    db_port: String(database.db_port ?? DEFAULT_DB_PORT),
    division: database.division
  };
}

function toInput(form: InventoryFormState): DatabaseInventoryInput {
  return {
    database_name: form.database_name.trim(),
    environment: form.environment.trim(),
    location: form.location.trim(),
    operating_system: form.operating_system,
    database_role: form.database_role,
    database_type: form.database_type,
    status: form.status,
    environment_label: form.environment_label,
    owner_id: Number(form.owner_id),
    server_name: form.server_name.trim() || undefined,
    server_ip: form.server_ip.trim() || undefined,
    zone: form.zone.trim(),
    server_type: form.server_type,
    db_version: form.db_version.trim() || undefined,
    db_edition: form.db_edition.trim() || undefined,
    db_port: form.db_port.trim() !== "" ? Number(form.db_port) : undefined,
    division: form.division
  };
}

function ownerLabel(user?: AppUser) {
  if (!user) return "Unknown owner";
  return `${user.username} (${user.email})`;
}

export function DbInventory() {
  const setDatabases = useAppStore((state) => state.setDatabases);
  const [databases, setLocalDatabases] = useState<DatabaseInventoryItem[]>([]);
  const [clients, setClients] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedEnvLabel, setSelectedEnvLabel] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedDbType, setSelectedDbType] = useState<string>("all");
  const [selectedOs, setSelectedOs] = useState<string>("all");
  const [selectedZone, setSelectedZone] = useState<string>("all");
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [selectedServerType, setSelectedServerType] = useState<string>("all");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<DatabaseInventoryItem | null>(null);
  const [ownerTarget, setOwnerTarget] = useState<DatabaseInventoryItem | null>(null);
  const [deleting, setDeleting] = useState<DatabaseInventoryItem | null>(null);
  const [form, setForm] = useState<InventoryFormState>(emptyForm);
  const [ownerId, setOwnerId] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dbResponse, clientResponse] = await Promise.all([
        fetchDatabases(),
        fetchUsersByRole("client")
      ]);
      setLocalDatabases(dbResponse.databases);
      setDatabases(dbResponse.databases);
      setClients(clientResponse.users.filter((user) => user.isActive));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load DB inventory.";
      toast.error("DB inventory unavailable", { description: message });
    } finally {
      setLoading(false);
    }
  }, [setDatabases]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredDatabases = useMemo(() => {
    return databases.filter((database) => {
      // 1. Text Search Filter
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery) {
        const matchesText = [
          database.database_name,
          database.environment,
          database.location,
          database.os,
          database.owner?.username,
          database.db_type,
          database.status,
          database.server_name,
          database.server_ip,
          database.zone,
          database.server_type,
          database.db_version,
          database.db_edition,
          String(database.db_port ?? ""),
          database.division
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
        if (!matchesText) return false;
      }

      // 2. Environment Label Filter
      if (selectedEnvLabel !== "all" && database.env_label !== selectedEnvLabel) {
        return false;
      }

      // 3. Status Filter
      if (selectedStatus !== "all" && database.status !== selectedStatus) {
        return false;
      }

      // 4. DB Type Filter
      if (selectedDbType !== "all" && database.db_type !== selectedDbType) {
        return false;
      }

      // 5. Operating System Filter
      if (selectedOs !== "all" && database.os !== selectedOs) {
        return false;
      }

      // 6. Zone Filter
      if (selectedZone !== "all" && database.zone !== selectedZone) {
        return false;
      }

      // 7. Division Filter
      if (selectedDivision !== "all" && database.division !== selectedDivision) {
        return false;
      }

      // 8. Server Type Filter
      if (selectedServerType !== "all" && database.server_type !== selectedServerType) {
        return false;
      }

      return true;
    });
  }, [databases, query, selectedEnvLabel, selectedStatus, selectedDbType, selectedOs, selectedZone, selectedDivision, selectedServerType]);

  const hasActiveFilters = useMemo(() => {
    return (
      query.trim() !== "" ||
      selectedEnvLabel !== "all" ||
      selectedStatus !== "all" ||
      selectedDbType !== "all" ||
      selectedOs !== "all" ||
      selectedZone !== "all" ||
      selectedDivision !== "all" ||
      selectedServerType !== "all"
    );
  }, [query, selectedEnvLabel, selectedStatus, selectedDbType, selectedOs, selectedZone, selectedDivision, selectedServerType]);

  const handleClearFilters = () => {
    setQuery("");
    setSelectedEnvLabel("all");
    setSelectedStatus("all");
    setSelectedDbType("all");
    setSelectedOs("all");
    setSelectedZone("all");
    setSelectedDivision("all");
    setSelectedServerType("all");
  };

  const openCreate = () => {
    setForm({ ...emptyForm, owner_id: clients[0]?.userId ? String(clients[0].userId) : "" });
    setCreateOpen(true);
  };

  const openEdit = (database: DatabaseInventoryItem) => {
    setEditing(database);
    setForm(toForm(database));
    setEditOpen(true);
  };

  const openOwner = (database: DatabaseInventoryItem) => {
    setOwnerTarget(database);
    setOwnerId(String(database.owner_id));
    setOwnerOpen(true);
  };

  const openDelete = (database: DatabaseInventoryItem) => {
    setDeleting(database);
    setDeleteOpen(true);
  };

  const updateFormField = <K extends keyof InventoryFormState>(key: K, value: InventoryFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const applyDatabaseUpdate = (database: DatabaseInventoryItem) => {
    const next = databases.some((item) => item.id === database.id)
      ? databases.map((item) => (item.id === database.id ? database : item))
      : [database, ...databases];
    setLocalDatabases(next);
    setDatabases(next);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await createDatabase(toInput(form));
      applyDatabaseUpdate(response.database);
      setCreateOpen(false);
      toast.success("Database added to inventory");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create database.";
      toast.error("Create failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const response = await updateDatabase(editing.id, toInput(form));
      applyDatabaseUpdate(response.database);
      setEditOpen(false);
      setEditing(null);
      toast.success("Database inventory updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update database.";
      toast.error("Update failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleOwnerChange = async () => {
    if (!ownerTarget) return;
    setSaving(true);
    try {
      const response = await changeDatabaseOwner(ownerTarget.id, Number(ownerId));
      applyDatabaseUpdate(response.database);
      setOwnerOpen(false);
      setOwnerTarget(null);
      toast.success("Database owner changed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change owner.";
      toast.error("Owner change failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await removeDatabase(deleting.id);
      const next = databases.filter((item) => item.id !== deleting.id);
      setLocalDatabases(next);
      setDatabases(next);
      setDeleteOpen(false);
      setDeleting(null);
      toast.success("Database removed from inventory");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete database.";
      toast.error("Delete failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const renderForm = (mode: "create" | "edit") => (
    <form onSubmit={mode === "create" ? handleCreate : handleEdit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${mode}-database-name`}>Database Name</Label>
          <Input
            id={`${mode}-database-name`}
            value={form.database_name}
            onChange={(event) => updateFormField("database_name", event.target.value)}
            maxLength={128}
            disabled={mode === "edit"}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Owner</Label>
          <Select value={form.owner_id} onValueChange={(value) => updateFormField("owner_id", value)} required>
            <SelectTrigger>
              <SelectValue placeholder="Select client owner" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.userId} value={String(client.userId)}>
                  {ownerLabel(client)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Division</Label>
          <Select value={form.division} onValueChange={(value) => updateFormField("division", value)} required>
            <SelectTrigger><SelectValue placeholder="Select division" /></SelectTrigger>
            <SelectContent>
              {DIVISION_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Environment</Label>
          <Select value={form.environment} onValueChange={(value) => updateFormField("environment", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENVIRONMENT_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Operating System</Label>
          <Select value={form.operating_system} onValueChange={(value) => updateFormField("operating_system", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {OS_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Environment Label</Label>
          <Select value={form.environment_label} onValueChange={(value) => updateFormField("environment_label", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENV_LABEL_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${mode}-server-name`}>Host Name</Label>
          <Input
            id={`${mode}-server-name`}
            value={form.server_name}
            onChange={(event) => updateFormField("server_name", event.target.value)}
            maxLength={128}
            placeholder="e.g. oracle-prod-01"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${mode}-server-ip`}>Server IP</Label>
          <Input
            id={`${mode}-server-ip`}
            value={form.server_ip}
            onChange={(event) => updateFormField("server_ip", event.target.value)}
            maxLength={45}
            placeholder="e.g. 192.168.1.50"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${mode}-db-version`}>DB Version</Label>
          <Input
            id={`${mode}-db-version`}
            value={form.db_version}
            onChange={(event) => updateFormField("db_version", event.target.value)}
            maxLength={40}
            placeholder="e.g. 19.21.0.0"
          />
        </div>
        <div className="space-y-2">
          <Label>DB Edition</Label>
          <Select value={form.db_edition} onValueChange={(value) => updateFormField("db_edition", value)}>
            <SelectTrigger><SelectValue placeholder="Select edition" /></SelectTrigger>
            <SelectContent>
              {DB_EDITION_OPTIONS_LIST.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Server Type</Label>
          <Select value={form.server_type} onValueChange={(value) => updateFormField("server_type", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SERVER_TYPE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${mode}-db-port`}>DB Port</Label>
          <Input
            id={`${mode}-db-port`}
            type="number"
            min={1}
            max={65535}
            value={form.db_port}
            onChange={(event) => updateFormField("db_port", event.target.value)}
            placeholder="e.g. 1521"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Location</Label>
          <Select value={form.location} onValueChange={(value) => updateFormField("location", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOCATION_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Zone</Label>
          <Select value={form.zone} onValueChange={(value) => updateFormField("zone", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ZONE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Database Role</Label>
          <Select value={form.database_role} onValueChange={(value) => updateFormField("database_role", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Database Type</Label>
          <Select value={form.database_type} onValueChange={(value) => updateFormField("database_type", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DB_TYPE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(value) => updateFormField("status", value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => (mode === "create" ? setCreateOpen(false) : setEditOpen(false))}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !clients.length}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "create" ? "Add database" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-200">
            <DatabaseZap className="h-4 w-4" />
            DB Inventory
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Database inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage database metadata and client ownership mappings.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!clients.length}>
          <Plus className="h-4 w-4" />
          Add database
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Inventory records</CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-semibold">{databases.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Client owners</CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-semibold">{clients.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Production DBs</CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-semibold">{databases.filter((db) => db.env_label === "PROD").length}</div></CardContent>
        </Card>
      </div>

      {!clients.length && !loading && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          Create at least one active client user before adding database inventory records.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b border-border/40 pb-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Databases</CardTitle>
              <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/5 text-cyan-300">
                {filteredDatabases.length} of {databases.length} visible
              </Badge>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search database, server, IP, owner..."
                  className="pl-9 bg-background/50 border-border/80 focus-visible:ring-cyan-500/30"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-2 h-10 border-border/80 bg-background/40 hover:bg-background/80 transition-colors",
                  showAdvanced && "bg-cyan-950/20 border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/30"
                )}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>Filters</span>
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 text-[10px] bg-cyan-500/20 text-cyan-200 border-0">
                    {
                      (query.trim() ? 1 : 0) +
                      (selectedEnvLabel !== "all" ? 1 : 0) +
                      (selectedStatus !== "all" ? 1 : 0) +
                      (selectedDbType !== "all" ? 1 : 0) +
                      (selectedOs !== "all" ? 1 : 0) +
                      (selectedZone !== "all" ? 1 : 0) +
                      (selectedDivision !== "all" ? 1 : 0) +
                      (selectedServerType !== "all" ? 1 : 0)
                    }
                  </Badge>
                )}
              </Button>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-10 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  Clear all
                </Button>
              )}
            </div>
          </div>

          {/* Advanced filters dropdown panel */}
          {showAdvanced && (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 p-4 rounded-lg border border-border/60 bg-muted/20 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Environment Label</label>
                <Select value={selectedEnvLabel} onValueChange={setSelectedEnvLabel}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Environments</SelectItem>
                    {ENV_LABEL_OPTIONS.map((env) => (
                      <SelectItem key={env} value={env}>{env}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">DB Type</label>
                <Select value={selectedDbType} onValueChange={setSelectedDbType}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All DB Types</SelectItem>
                    {DB_TYPE_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Operating System</label>
                <Select value={selectedOs} onValueChange={setSelectedOs}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All OS</SelectItem>
                    {OS_OPTIONS.map((os) => (
                      <SelectItem key={os} value={os}>{os}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Zone</label>
                <Select value={selectedZone} onValueChange={setSelectedZone}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Zones</SelectItem>
                    {ZONE_OPTIONS.map((zone) => (
                      <SelectItem key={zone} value={zone}>{zone}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Division</label>
                <Select value={selectedDivision} onValueChange={setSelectedDivision}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Divisions</SelectItem>
                    {DIVISION_OPTIONS.map((division) => (
                      <SelectItem key={division} value={division}>{division}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Server Type</label>
                <Select value={selectedServerType} onValueChange={setSelectedServerType}>
                  <SelectTrigger className="h-9 bg-background/50 border-border/80 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Server Types</SelectItem>
                    {SERVER_TYPE_OPTIONS.map((serverType) => (
                      <SelectItem key={serverType} value={serverType}>{serverType}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Active Filter Chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
              
              {query.trim() !== "" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Search: &quot;{query}&quot;
                  <button onClick={() => setQuery("")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedEnvLabel !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Env: {selectedEnvLabel}
                  <button onClick={() => setSelectedEnvLabel("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedStatus !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Status: {selectedStatus}
                  <button onClick={() => setSelectedStatus("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedDbType !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Type: {selectedDbType}
                  <button onClick={() => setSelectedDbType("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedOs !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  OS: {selectedOs}
                  <button onClick={() => setSelectedOs("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedZone !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Zone: {selectedZone}
                  <button onClick={() => setSelectedZone("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedDivision !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Division: {selectedDivision}
                  <button onClick={() => setSelectedDivision("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {selectedServerType !== "all" && (
                <Badge variant="secondary" className="gap-1 px-2.5 py-0.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/25">
                  Server Type: {selectedServerType}
                  <button onClick={() => setSelectedServerType("all")} className="rounded-full hover:bg-cyan-500/30 p-0.5 text-cyan-300 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading DB inventory
            </div>
          ) : (
            <Table className="min-w-[1500px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold uppercase tracking-wider text-cyan-300">Division</TableHead>
                  <TableHead>Database Name</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>DB Version</TableHead>
                  <TableHead>DB Edition</TableHead>
                  <TableHead>Server Type</TableHead>
                  <TableHead>Host Name</TableHead>
                  <TableHead>Server IP</TableHead>
                  <TableHead>DB Port</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Operating System</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Database Role</TableHead>
                  <TableHead>Database Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDatabases.map((database) => (
                  <TableRow key={database.id}>
                    <TableCell>
                      <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200 font-semibold">
                        {database.division}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{database.database_name}</TableCell>
                    <TableCell>
                      <Badge variant={database.env_label === "PROD" ? "destructive" : "secondary"}>{database.env_label}</Badge>
                    </TableCell>
                    <TableCell>{database.db_version || "-"}</TableCell>
                    <TableCell>{database.db_edition || "-"}</TableCell>
                    <TableCell>{database.server_type}</TableCell>
                    <TableCell>{database.server_name || "-"}</TableCell>
                    <TableCell>{database.server_ip || "-"}</TableCell>
                    <TableCell className="font-mono">{database.db_port ?? "-"}</TableCell>
                    <TableCell>{database.zone || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{database.location || "-"}</TableCell>
                    <TableCell>{database.os}</TableCell>
                    <TableCell>
                      {database.owner?.username || "-"}
                    </TableCell>
                    <TableCell>{database.role}</TableCell>
                    <TableCell>{database.db_type}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          database.status === "active"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : database.status === "inactive"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                              : "border-red-500/30 bg-red-500/10 text-red-400"
                        }
                      >
                        {database.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(database)} disabled={saving}>
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openOwner(database)} disabled={saving}>
                          <UserRoundCog className="h-4 w-4" />
                          Change Owner
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => openDelete(database)} disabled={saving}>
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!filteredDatabases.length && (
                  <TableRow>
                    <TableCell colSpan={17} className="h-24 text-center text-muted-foreground">
                      No databases found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add database</DialogTitle>
            <DialogDescription>Assign every database to an active client owner.</DialogDescription>
          </DialogHeader>
          {renderForm("create")}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit database</DialogTitle>
            <DialogDescription>Update metadata or reassign ownership.</DialogDescription>
          </DialogHeader>
          {renderForm("edit")}
        </DialogContent>
      </Dialog>

      <Dialog open={ownerOpen} onOpenChange={setOwnerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change database owner</DialogTitle>
            <DialogDescription>
              Reassign <strong className="text-foreground">{ownerTarget?.database_name}</strong> to another client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue placeholder="Select client owner" /></SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.userId} value={String(client.userId)}>
                    {ownerLabel(client)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOwnerOpen(false)}>Cancel</Button>
            <Button onClick={handleOwnerChange} disabled={saving || !ownerId}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Change owner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete database</DialogTitle>
            <DialogDescription>
              This removes <strong className="text-foreground">{deleting?.database_name}</strong> and its ownership mapping history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
