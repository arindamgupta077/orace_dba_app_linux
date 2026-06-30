"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Database,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createBackupTemplateApi,
  deleteBackupTemplateApi,
  fetchBackupStatusChecks,
  fetchBackupTemplates,
  fetchDatabases,
  fetchDbStatusChecks,
  saveBackupStatusCheck,
  saveDbStatusCheck,
  updateBackupTemplateApi
} from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type {
  BackupStatusCheck,
  BackupStatusValue,
  BackupTemplate,
  DatabaseInventoryItem,
  DbStatusCheck,
  DbStatusValue
} from "@/types/dba";

const DB_STATUS_OPTIONS: DbStatusValue[] = ["UP", "DOWN", "PARTIAL", "MAINTENANCE"];
const BACKUP_STATUS_OPTIONS: BackupStatusValue[] = ["SUCCESS", "FAILED", "RUNNING", "NOT_STARTED", "UNKNOWN"];
const BACKUP_TYPE_OPTIONS = ["FULL", "INCREMENTAL L0", "INCREMENTAL L1", "ARCHIVELOG", "DATA PUMP"];

function dbStatusBadge(status: DbStatusValue) {
  const map: Record<DbStatusValue, string> = {
    UP: "border-green-500/30 bg-green-500/10 text-green-300",
    DOWN: "border-red-500/30 bg-red-500/10 text-red-300",
    PARTIAL: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    MAINTENANCE: "border-blue-500/30 bg-blue-500/10 text-blue-300"
  };
  return <Badge className={map[status]}>{status}</Badge>;
}

function backupStatusBadge(status: BackupStatusValue) {
  const map: Record<BackupStatusValue, string> = {
    SUCCESS: "border-green-500/30 bg-green-500/10 text-green-300",
    FAILED: "border-red-500/30 bg-red-500/10 text-red-300",
    RUNNING: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    NOT_STARTED: "border-muted-foreground/30 bg-muted/20 text-muted-foreground",
    UNKNOWN: "border-amber-500/30 bg-amber-500/10 text-amber-300"
  };
  return <Badge className={map[status]}>{status}</Badge>;
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DailyChecklistSection() {
  const user = useAppStore((s) => s.user);
  const isAdmin = user?.role === "app_admin";
  const canManage = user?.role === "app_admin" || user?.role === "dba_admin";

  const [databases, setDatabases] = useState<DatabaseInventoryItem[]>([]);
  const [backupTemplates, setBackupTemplates] = useState<BackupTemplate[]>([]);
  const [dbChecks, setDbChecks] = useState<DbStatusCheck[]>([]);
  const [backupChecks, setBackupChecks] = useState<BackupStatusCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [shiftNumber, setShiftNumber] = useState<string>("1");
  const [shiftDate, setShiftDate] = useState<string>(todayStr());
  const [search, setSearch] = useState("");
  const [templateDialog, setTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BackupTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dbResult, tplResult, dbCheckResult, bkCheckResult] = await Promise.all([
        fetchDatabases(),
        fetchBackupTemplates(),
        fetchDbStatusChecks(Number(shiftNumber), shiftDate),
        fetchBackupStatusChecks(Number(shiftNumber), shiftDate)
      ]);
      setDatabases(dbResult.databases || []);
      setBackupTemplates(tplResult.templates || []);
      setDbChecks(dbCheckResult.checks || []);
      setBackupChecks(bkCheckResult.checks || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load checklist data.");
    } finally {
      setLoading(false);
    }
  }, [shiftNumber, shiftDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeDatabases = useMemo(
    () => databases.filter((d) => d.status === "active"),
    [databases]
  );

  const filteredDatabases = useMemo(() => {
    if (!search) return activeDatabases;
    const q = search.toUpperCase();
    return activeDatabases.filter((d) => d.database_name.toUpperCase().includes(q));
  }, [activeDatabases, search]);

  const filteredTemplates = useMemo(() => {
    if (!search) return backupTemplates;
    const q = search.toUpperCase();
    return backupTemplates.filter(
      (t) => t.backup_name.toUpperCase().includes(q) || t.database_name.toUpperCase().includes(q)
    );
  }, [backupTemplates, search]);

  const dbCheckMap = useMemo(() => {
    const map = new Map<number, DbStatusCheck>();
    for (const c of dbChecks) map.set(c.database_id, c);
    return map;
  }, [dbChecks]);

  const backupCheckMap = useMemo(() => {
    const map = new Map<number, BackupStatusCheck>();
    for (const c of backupChecks) map.set(c.backup_id, c);
    return map;
  }, [backupChecks]);

  const dbCompletion = useMemo(() => {
    const total = activeDatabases.length;
    const completed = dbChecks.length;
    return { total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  }, [activeDatabases, dbChecks]);

  const backupCompletion = useMemo(() => {
    const total = backupTemplates.filter((t) => t.is_active).length;
    const completed = backupChecks.length;
    return { total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  }, [backupTemplates, backupChecks]);

  const handleSaveDbStatus = async (databaseId: number, status: DbStatusValue, comment?: string) => {
    const key = `db-${databaseId}`;
    setSaving(key);
    try {
      await saveDbStatusCheck({
        databaseId,
        shiftNumber: Number(shiftNumber),
        shiftDate,
        status,
        commentText: comment
      });
      toast.success(`Status saved for ${activeDatabases.find((d) => d.id === databaseId)?.database_name}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save status.");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveBackupStatus = async (backupId: number, databaseId: number, status: BackupStatusValue, comment?: string) => {
    const key = `bk-${backupId}`;
    setSaving(key);
    try {
      await saveBackupStatusCheck({
        backupId,
        databaseId,
        shiftNumber: Number(shiftNumber),
        shiftDate,
        status,
        commentText: comment
      });
      toast.success("Backup status saved.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save backup status.");
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteTemplate = async (id: number, name: string) => {
    if (!confirm(`Delete backup template "${name}"? This will also remove all associated check records.`)) return;
    try {
      await deleteBackupTemplateApi(id);
      toast.success("Backup template deleted.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete template.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Shift</Label>
              <Select value={shiftNumber} onValueChange={setShiftNumber}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Shift 1</SelectItem>
                  <SelectItem value="2">Shift 2</SelectItem>
                  <SelectItem value="3">Shift 3</SelectItem>
                  <SelectItem value="4">General Shift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search databases..."
                  className="pl-8"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="database">
        <TabsList>
          <TabsTrigger value="database" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Database Status
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-1.5">
            <Archive className="h-3.5 w-3.5" />
            Backup Status
          </TabsTrigger>
        </TabsList>

        {/* Database Status Tab */}
        <TabsContent value="database">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-cyan-400" />
                Database Availability Check
              </CardTitle>
              <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                {dbCompletion.completed}/{dbCompletion.total} checked ({dbCompletion.pct}%)
              </Badge>
            </CardHeader>
            <CardContent>
              {filteredDatabases.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No active databases found in inventory.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Database</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Checked By</TableHead>
                      <TableHead>Check Time</TableHead>
                      <TableHead>Comment</TableHead>
                      {canManage && <TableHead className="text-right">Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDatabases.map((db) => {
                      const check = dbCheckMap.get(db.id);
                      return (
                        <DbStatusRow
                          key={db.id}
                          database={db}
                          check={check}
                          canManage={canManage}
                          saving={saving === `db-${db.id}`}
                          onSave={(status, comment) => void handleSaveDbStatus(db.id, status, comment)}
                        />
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Backup Status Tab */}
        <TabsContent value="backup">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Archive className="h-5 w-5 text-cyan-400" />
                Backup Status Check
              </CardTitle>
              <div className="flex items-center gap-3">
                <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                  {backupCompletion.completed}/{backupCompletion.total} checked ({backupCompletion.pct}%)
                </Badge>
                {isAdmin && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingTemplate(null);
                      setTemplateDialog(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Manage Templates
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {filteredTemplates.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No backup templates defined.
                  {isAdmin && " Use \"Manage Templates\" to add backup definitions."}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Backup Name</TableHead>
                      <TableHead>Database</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Checked By</TableHead>
                      <TableHead>Check Time</TableHead>
                      <TableHead>Comment</TableHead>
                      {canManage && <TableHead className="text-right">Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTemplates.map((tpl) => {
                      const check = backupCheckMap.get(tpl.backup_id);
                      return (
                        <BackupStatusRow
                          key={tpl.backup_id}
                          template={tpl}
                          check={check}
                          canManage={canManage}
                          saving={saving === `bk-${tpl.backup_id}`}
                          onSave={(status, comment) =>
                            void handleSaveBackupStatus(tpl.backup_id, tpl.database_id, status, comment)
                          }
                        />
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Backup template manager dialog */}
      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Backup Template Management</DialogTitle>
            <DialogDescription>
              Define backup schedules that DBAs verify each shift. Only app_admin can modify templates.
            </DialogDescription>
          </DialogHeader>
          <BackupTemplateManager
            templates={backupTemplates}
            databases={databases}
            editingTemplate={editingTemplate}
            onEdit={(t) => setEditingTemplate(t)}
            onDelete={(id, name) => void handleDeleteTemplate(id, name)}
            onSaved={async () => {
              await load();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----- DB Status Row -----
function DbStatusRow({
  database,
  check,
  canManage,
  saving,
  onSave
}: {
  database: DatabaseInventoryItem;
  check?: DbStatusCheck;
  canManage: boolean;
  saving: boolean;
  onSave: (status: DbStatusValue, comment?: string) => void;
}) {
  const [status, setStatus] = useState<DbStatusValue>(check?.status || "UP");
  const [comment, setComment] = useState(check?.comment_text || "");

  useEffect(() => {
    setStatus(check?.status || "UP");
    setComment(check?.comment_text || "");
  }, [check]);

  return (
    <TableRow>
      <TableCell className="font-medium">{database.database_name}</TableCell>
      <TableCell>{check ? dbStatusBadge(check.status) : <Badge variant="outline" className="text-muted-foreground">Not checked</Badge>}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{check?.checked_username || "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{check ? new Date(check.checked_at).toLocaleTimeString() : "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{check?.comment_text || "—"}</TableCell>
      {canManage && (
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Select value={status} onValueChange={(v) => setStatus(v as DbStatusValue)}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DB_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment..."
              className="h-8 w-32"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSave(status, comment.trim() || undefined)}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

// ----- Backup Status Row -----
function BackupStatusRow({
  template,
  check,
  canManage,
  saving,
  onSave
}: {
  template: BackupTemplate;
  check?: BackupStatusCheck;
  canManage: boolean;
  saving: boolean;
  onSave: (status: BackupStatusValue, comment?: string) => void;
}) {
  const [status, setStatus] = useState<BackupStatusValue>(check?.status || "NOT_STARTED");
  const [comment, setComment] = useState(check?.comment_text || "");

  useEffect(() => {
    setStatus(check?.status || "NOT_STARTED");
    setComment(check?.comment_text || "");
  }, [check]);

  return (
    <TableRow>
      <TableCell className="font-medium">{template.backup_name}</TableCell>
      <TableCell className="text-sm">{template.database_name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{template.scheduled_time || "—"}</TableCell>
      <TableCell>{check ? backupStatusBadge(check.status) : <Badge variant="outline" className="text-muted-foreground">Not checked</Badge>}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{check?.checked_username || "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{check ? new Date(check.checked_at).toLocaleTimeString() : "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{check?.comment_text || "—"}</TableCell>
      {canManage && (
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Select value={status} onValueChange={(v) => setStatus(v as BackupStatusValue)}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKUP_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment..."
              className="h-8 w-32"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSave(status, comment.trim() || undefined)}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

// ----- Backup Template Manager -----
function BackupTemplateManager({
  templates,
  databases,
  editingTemplate,
  onEdit,
  onDelete,
  onSaved
}: {
  templates: BackupTemplate[];
  databases: DatabaseInventoryItem[];
  editingTemplate: BackupTemplate | null;
  onEdit: (t: BackupTemplate) => void;
  onDelete: (id: number, name: string) => void;
  onSaved: () => Promise<void>;
}) {
  const [formDb, setFormDb] = useState("");
  const [formName, setFormName] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formType, setFormType] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingTemplate) {
      setFormDb(String(editingTemplate.database_id));
      setFormName(editingTemplate.backup_name);
      setFormTime(editingTemplate.scheduled_time || "");
      setFormType(editingTemplate.backup_type || "");
    } else {
      setFormDb("");
      setFormName("");
      setFormTime("");
      setFormType("");
    }
  }, [editingTemplate]);

  const handleSave = async () => {
    if (!formDb || !formName.trim()) {
      toast.error("Database and backup name are required.");
      return;
    }
    setSaving(true);
    try {
      if (editingTemplate) {
        await updateBackupTemplateApi(editingTemplate.backup_id, {
          databaseId: Number(formDb),
          backupName: formName.trim(),
          scheduledTime: formTime.trim() || undefined,
          backupType: formType.trim() || undefined,
          isActive: editingTemplate.is_active
        });
        toast.success("Backup template updated.");
      } else {
        await createBackupTemplateApi({
          databaseId: Number(formDb),
          backupName: formName.trim(),
          scheduledTime: formTime.trim() || undefined,
          backupType: formType.trim() || undefined
        });
        toast.success("Backup template created.");
      }
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Form */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border/70 p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Database</Label>
          <Select value={formDb} onValueChange={setFormDb}>
            <SelectTrigger>
              <SelectValue placeholder="Select database" />
            </SelectTrigger>
            <SelectContent>
              {databases.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.database_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Backup Name</Label>
          <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. RMAN Full Backup" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Scheduled Time (HH:MM)</Label>
          <Input value={formTime} onChange={(e) => setFormTime(e.target.value)} placeholder="e.g. 02:00" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Backup Type</Label>
          <Select value={formType} onValueChange={setFormType}>
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {BACKUP_TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-full flex items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {editingTemplate ? "Update" : "Add"} Template
          </Button>
          {editingTemplate && (
            <Button variant="outline" onClick={() => onEdit(editingTemplate)}>
              <X className="h-4 w-4" />
              Cancel Edit
            </Button>
          )}
        </div>
      </div>

      {/* Template list */}
      <div className="max-h-[300px] overflow-y-auto rounded-md border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Backup Name</TableHead>
              <TableHead>Database</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  No templates defined yet.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <TableRow key={t.backup_id}>
                  <TableCell className="font-medium">{t.backup_name}</TableCell>
                  <TableCell className="text-sm">{t.database_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.scheduled_time || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.backup_type || "—"}</TableCell>
                  <TableCell>
                    <Badge className={cn(t.is_active ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-muted-foreground/30 text-muted-foreground")}>
                      {t.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:bg-red-500/10"
                        onClick={() => onDelete(t.backup_id, t.backup_name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
