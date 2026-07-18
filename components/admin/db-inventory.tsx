"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseZap, Edit3, FileDown, FlaskConical, Loader2, Plus, Search, Trash2, SlidersHorizontal, X, RotateCcw, Columns3, Power, Server, Users, ShieldCheck, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

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
  fetchDatabaseInventoryColumns,
  fetchDatabases,
  fetchUsersByRole,
  removeDatabase,
  updateDatabaseAccess,
  updateDatabaseInventoryColumns,
  updateDatabase
} from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { AppUser, DatabaseInventoryInput, DatabaseInventoryItem, DbDivision, DbEdition, DbEnvironment, DbOs, DbServerType, DbType } from "@/types/dba";
import { DB_DIVISION_OPTIONS, DB_EDITION_OPTIONS } from "@/types/dba";

const ENVIRONMENT_OPTIONS = ["Production", "non-production", "DR"];
const OS_OPTIONS: DbOs[] = ["Linux", "Windows"];
const ROLE_OPTIONS = ["Primary", "Standby", "Reporting"];
const DB_TYPE_OPTIONS: DbType[] = ["Standalone", "RAC", "Dataguard", "Active Dataguard", "RAC & Datagaurd"];
const STATUS_OPTIONS = ["active", "inactive", "decomissioned"];
const ENV_LABEL_OPTIONS: DbEnvironment[] = ["PROD", "DEV", "UAT", "DR"];
const LOCATION_OPTIONS = ["SDC", "KDC"];
const ZONE_OPTIONS = ["SZ1", "SZ2", "LAN"] as const;
const SERVER_TYPE_OPTIONS: DbServerType[] = ["Physical", "Virtual"];
const DIVISION_OPTIONS: DbDivision[] = DB_DIVISION_OPTIONS;
const DB_EDITION_OPTIONS_LIST: readonly DbEdition[] = DB_EDITION_OPTIONS;
const DEFAULT_DB_PORT = 1521;

const INVENTORY_COLUMNS = [
  ["division", "Division"],
  ["database_name", "Database Name"],
  ["database_instance", "Database Instance"],
  ["environment", "Environment"],
  ["db_version", "DB Version"],
  ["db_edition", "DB Edition"],
  ["server_type", "Server Type"],
  ["server_name", "Host Name"],
  ["server_ip", "Server IP"],
  ["db_port", "DB Port"],
  ["zone", "Zone"],
  ["location", "Location"],
  ["operating_system", "Operating System"],
  ["owner", "Owner"],
  ["database_role", "Database Role"],
  ["database_type", "Database Type"],
  ["status", "Status"],
  ["enable_access", "Enable Access"]
] as const;

type InventoryColumnKey = (typeof INVENTORY_COLUMNS)[number][0];
const DEFAULT_VISIBLE_COLUMNS: InventoryColumnKey[] = [
  "division", "database_name", "database_instance", "environment", "db_version",
  "db_edition", "server_name", "server_ip", "db_port", "zone", "location",
  "operating_system", "database_type"
];

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
  database_instance: string;
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
  database_instance: "",
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
    database_instance: database.database_instance || "",
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
    database_instance: form.database_instance.trim() || undefined,
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
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<InventoryColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<DatabaseInventoryItem | null>(null);
  const [ownerTarget, setOwnerTarget] = useState<DatabaseInventoryItem | null>(null);
  const [deleting, setDeleting] = useState<DatabaseInventoryItem | null>(null);
  const [form, setForm] = useState<InventoryFormState>(emptyForm);
  const [ownerId, setOwnerId] = useState("");

  const refreshSelectorDatabases = useCallback(async () => {
    const response = await fetchDatabases({ selectorOnly: true });
    setDatabases(response.databases);
  }, [setDatabases]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dbResponse, clientResponse, columnResponse, selectorResponse] = await Promise.all([
        fetchDatabases(),
        fetchUsersByRole("client"),
        fetchDatabaseInventoryColumns(),
        fetchDatabases({ selectorOnly: true })
      ]);
      setLocalDatabases(dbResponse.databases);
      setDatabases(selectorResponse.databases);
      setClients(clientResponse.users.filter((user) => user.isActive));
      const validColumns = columnResponse.columns.filter((column): column is InventoryColumnKey =>
        INVENTORY_COLUMNS.some(([key]) => key === column)
      );
      setVisibleColumns(validColumns.length ? validColumns : DEFAULT_VISIBLE_COLUMNS);
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
          database.database_instance,
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
    void refreshSelectorDatabases();
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
      await refreshSelectorDatabases();
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

  const handleColumnVisibilityChange = async (column: InventoryColumnKey, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...visibleColumns, column]))
      : visibleColumns.filter((item) => item !== column);
    if (!next.length) {
      toast.error("Select at least one inventory column.");
      return;
    }
    setVisibleColumns(next);
    try {
      const response = await updateDatabaseInventoryColumns(next);
      setVisibleColumns(response.columns.filter((item): item is InventoryColumnKey => INVENTORY_COLUMNS.some(([key]) => key === item)));
    } catch (error) {
      setVisibleColumns(visibleColumns);
      toast.error("Column preference was not saved", { description: error instanceof Error ? error.message : undefined });
    }
  };

  const handleAccessToggle = async (database: DatabaseInventoryItem) => {
    setSaving(true);
    try {
      const response = await updateDatabaseAccess(database.id, !database.enable_access);
      const next = databases.map((item) =>
        item.database_name.trim().toUpperCase() === response.database.database_name.trim().toUpperCase()
          ? { ...item, enable_access: response.database.enable_access }
          : item
      );
      setLocalDatabases(next);
      await refreshSelectorDatabases();
      toast.success(`Selector access ${response.database.enable_access ? "enabled" : "disabled"} for ${database.database_name}`);
    } catch (error) {
      toast.error("Access update failed", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const exportToExcel = () => {
    // Build column label map
    const colMap = Object.fromEntries(INVENTORY_COLUMNS.map(([k, label]) => [k, label]));
    // Map each filtered row to a plain object with readable column headers
    const rows = filteredDatabases.map((db) => {
      const row: Record<string, string | number | boolean | null> = {};
      for (const col of visibleColumns) {
        const header = colMap[col] ?? col;
        switch (col) {
          case "division":          row[header] = db.division; break;
          case "database_name":     row[header] = db.database_name; break;
          case "database_instance": row[header] = db.database_instance ?? ""; break;
          case "environment":       row[header] = db.env_label; break;
          case "db_version":        row[header] = db.db_version ?? ""; break;
          case "db_edition":        row[header] = db.db_edition ?? ""; break;
          case "server_type":       row[header] = db.server_type; break;
          case "server_name":       row[header] = db.server_name ?? ""; break;
          case "server_ip":         row[header] = db.server_ip ?? ""; break;
          case "db_port":           row[header] = db.db_port ?? ""; break;
          case "zone":              row[header] = db.zone ?? ""; break;
          case "location":          row[header] = db.location; break;
          case "operating_system":  row[header] = db.os; break;
          case "owner":             row[header] = db.owner?.username ?? ""; break;
          case "database_role":     row[header] = db.role; break;
          case "database_type":     row[header] = db.db_type; break;
          case "status":            row[header] = db.status; break;
          case "enable_access":     row[header] = db.enable_access ? "Yes" : "No"; break;
          default:                  row[header] = "";
        }
      }
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    // Auto-fit column widths based on content
    const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.max(
        key.length,
        ...rows.map((r) => String(r[key] ?? "").length)
      ) + 2,
    }));
    worksheet["!cols"] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "DB Inventory");
    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `db_inventory_${timestamp}.xlsx`);
    toast.success(`Exported ${rows.length} record${rows.length !== 1 ? "s" : ""} to Excel`);
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
        <div className="space-y-2">
          <Label htmlFor={`${mode}-database-instance`}>Database Instance</Label>
          <Input
            id={`${mode}-database-instance`}
            value={form.database_instance}
            onChange={(event) => updateFormField("database_instance", event.target.value)}
            maxLength={128}
            placeholder="e.g. ORCL1"
            required
          />
          <p className="text-xs text-muted-foreground">Create one inventory record per RAC instance.</p>
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

  const renderInventoryCell = (database: DatabaseInventoryItem, column: InventoryColumnKey) => {
    switch (column) {
      case "division": return (
        <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-300 font-semibold tracking-wide text-[10px] uppercase px-2">
          {database.division}
        </Badge>
      );
      case "database_name": return (
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <DatabaseZap className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          {database.database_name}
        </span>
      );
      case "database_instance": return (
        <span className="font-mono text-xs text-cyan-300/80 bg-cyan-500/5 border border-cyan-500/15 rounded px-1.5 py-0.5">
          {database.database_instance || <span className="text-muted-foreground/50">—</span>}
        </span>
      );
      case "environment": {
        const envColors: Record<string, string> = {
          PROD: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
          DR:   "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
          UAT:  "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
          DEV:  "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300",
        };
        return (
          <Badge variant="outline" className={cn("font-semibold text-[10px] uppercase tracking-wider px-2", envColors[database.env_label] ?? "border-border/50 bg-muted/30 text-muted-foreground")}>
            {database.env_label}
          </Badge>
        );
      }
      case "db_version": return (
        <span className="font-mono text-xs">{database.db_version || <span className="text-muted-foreground/40">—</span>}</span>
      );
      case "db_edition": {
        const isEnterprise = (database.db_edition || "").toLowerCase().includes("enterprise");
        return (
          <span className={cn("text-xs font-medium", isEnterprise ? "text-amber-300" : "text-muted-foreground")}>
            {database.db_edition || "—"}
          </span>
        );
      }
      case "server_type": return (
        <Badge variant="outline" className="border-sky-500/30 bg-sky-500/8 text-sky-300 text-[10px] uppercase tracking-wide">
          {database.server_type}
        </Badge>
      );
      case "server_name": return (
        <span className="font-mono text-xs text-slate-300">{database.server_name || <span className="text-muted-foreground/40">—</span>}</span>
      );
      case "server_ip": return (
        <span className="font-mono text-xs text-emerald-300/80">{database.server_ip || <span className="text-muted-foreground/40">—</span>}</span>
      );
      case "db_port": return (
        <span className="font-mono text-xs bg-muted/40 border border-border/40 rounded px-1.5 py-0.5 text-slate-300">
          {database.db_port ?? <span className="text-muted-foreground/40">—</span>}
        </span>
      );
      case "zone": return (
        <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/8 text-indigo-300 text-[10px] uppercase tracking-wide">
          {database.zone || "—"}
        </Badge>
      );
      case "location": return (
        <span className="text-xs font-medium text-slate-400">{database.location || <span className="text-muted-foreground/40">—</span>}</span>
      );
      case "operating_system": return (
        <span className="text-xs font-medium text-slate-300">{database.os}</span>
      );
      case "owner": return (
        <span className="text-xs text-muted-foreground">{database.owner?.username || "—"}</span>
      );
      case "database_role": {
        const roleColors: Record<string, string> = {
          primary:   "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
          standby:   "border-blue-500/40 bg-blue-500/10 text-blue-300",
          reporting: "border-purple-500/40 bg-purple-500/10 text-purple-300",
        };
        return (
          <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", roleColors[(database.role || "").toLowerCase()] ?? "border-border/50 text-muted-foreground")}>
            {database.role}
          </Badge>
        );
      }
      case "database_type": {
        const typeColors: Record<string, string> = {
          "Standalone":        "border-slate-500/40 bg-slate-500/10 text-slate-300",
          "RAC":               "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
          "Dataguard":         "border-violet-500/40 bg-violet-500/10 text-violet-300",
          "Active Dataguard":  "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
          "RAC & Datagaurd":   "border-teal-500/40 bg-teal-500/10 text-teal-300",
        };
        return (
          <Badge variant="outline" className={cn("text-[10px] font-semibold", typeColors[database.db_type] ?? "border-border/50 text-muted-foreground")}>
            {database.db_type}
          </Badge>
        );
      }
      case "status": {
        const statusMap: Record<string, { cls: string; icon: React.ReactNode }> = {
          active:       { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: <CheckCircle2 className="h-3 w-3" /> },
          inactive:     { cls: "border-amber-500/40 bg-amber-500/10 text-amber-300",   icon: <AlertTriangle className="h-3 w-3" /> },
          decomissioned:{ cls: "border-red-500/40 bg-red-500/10 text-red-300",         icon: <XCircle className="h-3 w-3" /> },
        };
        const s = statusMap[database.status] ?? { cls: "border-border/50 text-muted-foreground", icon: null };
        return (
          <Badge variant="outline" className={cn("gap-1 font-semibold text-[10px] uppercase tracking-wide", s.cls)}>
            {s.icon}{database.status}
          </Badge>
        );
      }
      case "enable_access": return (
        <Badge variant="outline" className={database.enable_access ? "gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "gap-1 border-rose-500/40 bg-rose-500/10 text-rose-300"}>
          <Power className="h-3 w-3" />
          {database.enable_access ? "On" : "Off"}
        </Badge>
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-300">
            <DatabaseZap className="h-3.5 w-3.5" />
            DB Inventory
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">Database Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage database metadata and client ownership mappings.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!clients.length} className="gap-2 bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-500/20 transition-all">
          <Plus className="h-4 w-4" />
          Add Database
        </Button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Inventory Records */}
        <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background to-cyan-950/20 py-0">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent pointer-events-none" />
          <CardHeader className="px-4 pt-4 pb-1 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Inventory Records</CardTitle>
            <div className="h-7 w-7 rounded-md bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center shrink-0">
              <Server className="h-3.5 w-3.5 text-cyan-400" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight">{databases.length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Total database entries</p>
          </CardContent>
        </Card>

        {/* Client Owners */}
        <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background to-violet-950/20 py-0">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
          <CardHeader className="px-4 pt-4 pb-1 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Client Owners</CardTitle>
            <div className="h-7 w-7 rounded-md bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
              <Users className="h-3.5 w-3.5 text-violet-400" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight">{clients.length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Active client accounts</p>
          </CardContent>
        </Card>

        {/* Production DBs */}
        <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background to-red-950/20 py-0">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent pointer-events-none" />
          <CardHeader className="px-4 pt-4 pb-1 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Production DBs</CardTitle>
            <div className="h-7 w-7 rounded-md bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-3.5 w-3.5 text-red-400" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight">{databases.filter((db) => db.env_label === "PROD").length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Critical production systems</p>
          </CardContent>
        </Card>

        {/* Non-Prod DBs */}
        <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background to-teal-950/20 py-0">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent pointer-events-none" />
          <CardHeader className="px-4 pt-4 pb-1 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Non-Prod DBs</CardTitle>
            <div className="h-7 w-7 rounded-md bg-teal-500/15 border border-teal-500/25 flex items-center justify-center shrink-0">
              <FlaskConical className="h-3.5 w-3.5 text-teal-400" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight">{databases.filter((db) => db.env_label !== "PROD").length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">DEV, UAT &amp; DR systems</p>
          </CardContent>
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

              <Button
                variant="outline"
                size="sm"
                className="gap-2 h-10 border-border/80 bg-background/40 hover:bg-background/80"
                onClick={() => setColumnsOpen(true)}
              >
                <Columns3 className="h-4 w-4" />
                Columns
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-2 h-10 border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/60 hover:text-emerald-200 transition-colors disabled:opacity-50"
                onClick={exportToExcel}
                disabled={filteredDatabases.length === 0 || loading}
                title="Export visible rows to Excel"
              >
                <FileDown className="h-4 w-4" />
                Export
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
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
              <span>Loading database inventory…</span>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table className="min-w-[1300px]">
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/30 hover:bg-muted/30">
                    {INVENTORY_COLUMNS.filter(([key]) => visibleColumns.includes(key)).map(([key, label]) => (
                      <TableHead
                        key={key}
                        className={cn(
                          "text-[11px] font-bold uppercase tracking-wider py-3 whitespace-nowrap",
                          key === "division" ? "text-violet-300" : "text-muted-foreground"
                        )}
                      >
                        {label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right text-[11px] font-bold uppercase tracking-wider py-3 text-muted-foreground pr-4">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDatabases.map((database, idx) => (
                    <TableRow
                      key={database.id}
                      className={cn(
                        "border-b border-border/30 transition-colors",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/10",
                        "hover:bg-cyan-950/20"
                      )}
                    >
                      {INVENTORY_COLUMNS.filter(([key]) => visibleColumns.includes(key)).map(([key]) => (
                        <TableCell key={key} className="py-2.5 align-middle">
                          {renderInventoryCell(database, key)}
                        </TableCell>
                      ))}
                      <TableCell className="py-2 pr-4 align-middle">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md border border-border/50 text-muted-foreground hover:border-cyan-500/40 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                            onClick={() => openEdit(database)}
                            disabled={saving}
                            title="Edit record"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-7 w-7 rounded-md border transition-colors",
                              database.enable_access
                                ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50"
                                : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50"
                            )}
                            onClick={() => void handleAccessToggle(database)}
                            disabled={saving}
                            title={database.enable_access ? "Disable selector access" : "Enable selector access"}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
                            onClick={() => openDelete(database)}
                            disabled={saving}
                            title="Delete record"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredDatabases.length && (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 1} className="h-40 text-center">
                        <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                          <DatabaseZap className="h-10 w-10 opacity-20" />
                          <div>
                            <p className="font-medium">No databases found</p>
                            <p className="text-xs mt-0.5">Try adjusting your search filters</p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Visible inventory columns</DialogTitle>
            <DialogDescription>Your choices are saved to your user profile.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {INVENTORY_COLUMNS.map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 p-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(key)}
                  onChange={(event) => void handleColumnVisibilityChange(key, event.target.checked)}
                  className="h-4 w-4 accent-cyan-500"
                />
                {label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setColumnsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
