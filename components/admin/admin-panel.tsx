"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Clock,
  Database,
  Edit3,
  FileCheck,
  Filter,
  KeyRound,
  Loader2,
  Power,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
  UserX
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createAppUser, fetchAppUsers, removeAppUser, toggleAppUserStatus, updateAppUser } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { AppUser, AppUserRole } from "@/types/dba";

const ROLE_OPTIONS: Array<{ value: AppUserRole; label: string }> = [
  { value: "app_admin", label: "App Admin" },
  { value: "dba_admin", label: "DBA Admin" },
  { value: "client", label: "Client" },
  { value: "auditor", label: "Auditor" }
];

type StatusFilter = "active" | "inactive" | "all";
type RoleFilter = AppUserRole | "all";

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All Statuses" }
];

const ROLE_FILTER_OPTIONS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All Roles" },
  { value: "app_admin", label: "App Admin" },
  { value: "dba_admin", label: "DBA Admin" },
  { value: "client", label: "Client" },
  { value: "auditor", label: "Auditor" }
];

interface UserFormState {
  username: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  initialPassword: string;
}

const emptyForm: UserFormState = {
  username: "",
  email: "",
  role: "client",
  isActive: true,
  initialPassword: ""
};

function formatDate(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function roleLabel(role: AppUserRole) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role;
}

function getUserInitials(username: string): string {
  if (!username) return "U";
  const parts = username.trim().split(/[._-\s]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

function RoleBadge({ role }: { role: AppUserRole }) {
  switch (role) {
    case "app_admin":
      return (
        <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 gap-1.5 font-medium">
          <Shield className="h-3 w-3" />
          App Admin
        </Badge>
      );
    case "dba_admin":
      return (
        <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1.5 font-medium">
          <Database className="h-3 w-3" />
          DBA Admin
        </Badge>
      );
    case "auditor":
      return (
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1.5 font-medium">
          <FileCheck className="h-3 w-3" />
          Auditor
        </Badge>
      );
    case "client":
    default:
      return (
        <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400 gap-1.5 font-medium">
          <User className="h-3 w-3" />
          Client
        </Badge>
      );
  }
}

export function AdminPanel() {
  const currentUser = useAppStore((state) => state.user);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<AppUser | null>(null);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await fetchAppUsers();
      setUsers(response.users);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load users.";
      toast.error("Admin users unavailable", { description: message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    let result = users;

    // Status filter
    if (statusFilter === "active") {
      result = result.filter((user) => user.isActive);
    } else if (statusFilter === "inactive") {
      result = result.filter((user) => !user.isActive);
    }

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter((user) => user.role === roleFilter);
    }

    // Search query
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      result = result.filter((user) =>
        [user.username, user.email, user.role]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      );
    }

    return result;
  }, [query, users, statusFilter, roleFilter]);

  const appAdminCount = useMemo(() => users.filter((user) => user.role === "app_admin").length, [users]);
  const dbaAdminCount = useMemo(() => users.filter((user) => user.role === "dba_admin").length, [users]);
  const clientCount = useMemo(() => users.filter((user) => user.role === "client").length, [users]);
  const isFiltered = statusFilter !== "active" || roleFilter !== "all" || query.trim().length > 0;

  const resetFilters = () => {
    setStatusFilter("active");
    setRoleFilter("all");
    setQuery("");
  };

  const openCreate = () => {
    setForm(emptyForm);
    setCreateOpen(true);
  };

  const openEdit = (user: AppUser) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      initialPassword: ""
    });
    setEditOpen(true);
  };

  const openDelete = (user: AppUser) => {
    setDeletingUser(user);
    setDeleteOpen(true);
  };

  const updateForm = <K extends keyof UserFormState>(key: K, value: UserFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await createAppUser({
        username: form.username,
        email: form.email,
        role: form.role,
        isActive: form.isActive,
        initialPassword: form.initialPassword
      });
      setUsers((current) => [response.user, ...current]);
      setCreateOpen(false);
      setForm(emptyForm);
      toast.success("Application user created");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create user.";
      toast.error("Create failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    try {
      const response = await updateAppUser(editingUser.userId, {
        username: form.username,
        email: form.email,
        role: form.role,
        isActive: form.isActive
      });
      setUsers((current) =>
        current.map((user) => (user.userId === response.user.userId ? response.user : user))
      );
      setEditOpen(false);
      setEditingUser(null);
      toast.success("Application user updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update user.";
      toast.error("Update failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    setSaving(true);
    try {
      await removeAppUser(deletingUser.userId);
      setUsers((current) => current.filter((item) => item.userId !== deletingUser.userId));
      setDeleteOpen(false);
      setDeletingUser(null);
      toast.success("User permanently deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete user.";
      toast.error("Delete failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (user: AppUser) => {
    setSaving(true);
    try {
      const response = await toggleAppUserStatus(user.userId);
      setUsers((current) =>
        current.map((item) => (item.userId === response.user.userId ? response.user : item))
      );
      toast.success(`User ${response.user.isActive ? "activated" : "deactivated"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to toggle user status.";
      toast.error("Status change failed", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const renderUserForm = (mode: "create" | "edit") => (
    <form onSubmit={mode === "create" ? handleCreate : handleEdit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${mode}-username`}>Username</Label>
          <Input
            id={`${mode}-username`}
            value={form.username}
            onChange={(event) => updateForm("username", event.target.value)}
            maxLength={128}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${mode}-email`}>Email</Label>
          <Input
            id={`${mode}-email`}
            type="email"
            value={form.email}
            onChange={(event) => updateForm("email", event.target.value)}
            maxLength={320}
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Role</Label>
          <Select value={form.role} onValueChange={(value) => updateForm("role", value as AppUserRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex min-h-[38px] items-center gap-3 self-end rounded-md border border-border/70 bg-background/30 px-3 py-2 text-sm cursor-pointer hover:bg-accent/40 transition-colors">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => updateForm("isActive", event.target.checked)}
            className="h-4 w-4 rounded accent-red-500"
          />
          <span className="font-medium text-foreground">Active account</span>
        </label>
      </div>

      {mode === "create" && (
        <div className="space-y-2">
          <Label htmlFor="initial-password">Initial password</Label>
          <Input
            id="initial-password"
            type="password"
            autoComplete="new-password"
            value={form.initialPassword}
            onChange={(event) => updateForm("initialPassword", event.target.value)}
            minLength={8}
            maxLength={128}
            required
          />
        </div>
      )}

      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={() => (mode === "create" ? setCreateOpen(false) : setEditOpen(false))}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create user" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Compact Header & Action Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm shadow-sm">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border border-cyan-500/20">
                <ShieldCheck className="h-3 w-3" />
                Admin Panel
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Application Users</h1>
            <p className="text-xs text-muted-foreground">
              Manage portal accounts, role-based access, and security status.
            </p>
          </div>
          <div>
            <Button onClick={openCreate} className="h-9 px-4 text-xs font-semibold shadow-sm gap-2">
              <UserPlus className="h-4 w-4" />
              Create user
            </Button>
          </div>
        </div>

        {/* Compact Stat Cards Grid */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm hover:border-border transition-colors">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">Total users</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">{users.length}</span>
                <span className="text-[11px] text-muted-foreground">registered</span>
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <Users className="h-5 w-5" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm hover:border-border transition-colors">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">App admins</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400">{appAdminCount}</span>
                <span className="text-[11px] text-muted-foreground">full access</span>
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
              <Shield className="h-5 w-5" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm hover:border-border transition-colors">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">DBA admins</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-cyan-600 dark:text-cyan-400">{dbaAdminCount}</span>
                <span className="text-[11px] text-muted-foreground">database ops</span>
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
              <Database className="h-5 w-5" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm hover:border-border transition-colors">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">Client users</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">{clientCount}</span>
                <span className="text-[11px] text-muted-foreground">standard</span>
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <User className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* User Directory Table Card */}
        <Card className="border-border/70 shadow-sm overflow-hidden">
          {/* Header & Filter Controls Toolbar */}
          <div className="flex flex-col gap-3 border-b border-border/60 p-4 md:flex-row md:items-center md:justify-between bg-card/40">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">User Directory</h2>
              <Badge variant="secondary" className="px-2 py-0.5 text-xs font-medium">
                {filteredUsers.length} {filteredUsers.length === 1 ? "user" : "users"}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, email, role..."
                  className="h-8 pl-8 pr-3 text-xs bg-background/50 focus-visible:ring-1"
                />
              </div>

              <div className="flex items-center gap-2">
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                  <SelectTrigger className="h-8 w-[125px] text-xs bg-background/50">
                    <Filter className="mr-1.5 h-3 w-3 text-muted-foreground" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)}>
                  <SelectTrigger className="h-8 w-[130px] text-xs bg-background/50">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_FILTER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isFiltered && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={resetFilters}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Reset filters</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
                Loading application users...
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent border-b border-border/60">
                      <TableHead className="py-3 px-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        User
                      </TableHead>
                      <TableHead className="py-3 px-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Role
                      </TableHead>
                      <TableHead className="py-3 px-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Status
                      </TableHead>
                      <TableHead className="py-3 px-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Last Login
                      </TableHead>
                      <TableHead className="py-3 px-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Updated
                      </TableHead>
                      <TableHead className="py-3 px-4 text-right text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => {
                      const isSelf = currentUser?.userId === user.userId;
                      const initials = getUserInitials(user.username);

                      return (
                        <TableRow key={user.userId} className="group hover:bg-muted/30 transition-colors border-b border-border/40">
                          {/* User Info */}
                          <TableCell className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-xs border border-primary/20 shadow-xs">
                                {initials}
                              </div>
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground text-sm truncate">{user.username}</span>
                                  {isSelf && (
                                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-primary/5 text-primary border-primary/20">
                                      You
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground truncate font-mono">{user.email}</div>
                              </div>
                            </div>
                          </TableCell>

                          {/* Role */}
                          <TableCell className="py-3 px-4">
                            <RoleBadge role={user.role} />
                          </TableCell>

                          {/* Status */}
                          <TableCell className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {user.isActive ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium gap-1.5 px-2 py-0.5"
                                >
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                  </span>
                                  Active
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 font-medium gap-1.5 px-2 py-0.5"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
                                  Inactive
                                </Badge>
                              )}

                              {user.mustChangePassword && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] gap-1 px-1.5 py-0.5">
                                      <KeyRound className="h-3 w-3" />
                                      Reset
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>Password change required on next login</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>

                          {/* Last Login */}
                          <TableCell className="py-3 px-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                              <span>{formatDate(user.lastLoginAt)}</span>
                            </div>
                          </TableCell>

                          {/* Updated At */}
                          <TableCell className="py-3 px-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                              <span>{formatDate(user.updatedAt)}</span>
                            </div>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-block">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleToggleStatus(user)}
                                      disabled={saving || isSelf}
                                      className={`h-8 w-8 text-xs ${
                                        user.isActive
                                          ? "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                                          : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                                      }`}
                                    >
                                      <Power className="h-3.5 w-3.5" />
                                      <span className="sr-only">{user.isActive ? "Deactivate" : "Activate"}</span>
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  {isSelf ? "Cannot change your own account status" : user.isActive ? "Deactivate user account" : "Activate user account"}
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => openEdit(user)}
                                    disabled={saving}
                                    className="h-8 w-8 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    <span className="sr-only">Edit user</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Edit details & role</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-block">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openDelete(user)}
                                      disabled={saving || isSelf}
                                      className="h-8 w-8 text-xs text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      <span className="sr-only">Delete user</span>
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  {isSelf ? "Cannot delete your own admin account" : "Delete user permanently"}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-40 text-center">
                          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                            <UserX className="h-8 w-8 text-muted-foreground/50" />
                            <p className="text-sm font-medium">No users found</p>
                            <p className="text-xs text-muted-foreground">
                              {isFiltered
                                ? "Try adjusting your search query or filters."
                                : "No application users currently exist in the database."}
                            </p>
                            {isFiltered && (
                              <Button variant="outline" size="sm" onClick={resetFilters} className="mt-2 h-8 text-xs">
                                Clear search filters
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>

          {/* Table Footer Summary */}
          {!loading && filteredUsers.length > 0 && (
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 bg-muted/20 text-xs text-muted-foreground">
              <span>
                Showing <strong className="font-semibold text-foreground">{filteredUsers.length}</strong> of{" "}
                <strong className="font-semibold text-foreground">{users.length}</strong> total users
              </span>
              {isFiltered && (
                <span className="text-[11px] text-cyan-600 dark:text-cyan-400 font-medium">
                  Filtered view active
                </span>
              )}
            </div>
          )}
        </Card>

        {/* Dialogs */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-primary" />
                Create application user
              </DialogTitle>
              <DialogDescription className="text-xs">
                Set initial account details and password. Passwords are securely hashed before storage.
              </DialogDescription>
            </DialogHeader>
            {renderUserForm("create")}
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-primary" />
                Update application user
              </DialogTitle>
              <DialogDescription className="text-xs">
                Modify role permissions or account status for {editingUser?.username}.
              </DialogDescription>
            </DialogHeader>
            {renderUserForm("edit")}
          </DialogContent>
        </Dialog>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-destructive" />
                Delete user permanently
              </DialogTitle>
              <DialogDescription className="text-xs">
                This action cannot be undone. User <strong className="text-foreground">{deletingUser?.username}</strong> ({deletingUser?.email}) will be permanently removed.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                Warning: Permanent Action
              </p>
              <p className="text-muted-foreground">
                All associated sessions, user records, and role privileges will be permanently deleted from the database.
              </p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
