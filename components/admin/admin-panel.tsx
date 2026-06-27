"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Edit3, Filter, Loader2, Power, Search, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
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
import { createAppUser, fetchAppUsers, removeAppUser, toggleAppUserStatus, updateAppUser } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { AppUser, AppUserRole } from "@/types/dba";

const ROLE_OPTIONS: Array<{ value: AppUserRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "dba_admin", label: "DBA Admin" },
  { value: "operator", label: "Operator" },
  { value: "auditor", label: "Auditor" }
];

type StatusFilter = "active" | "inactive" | "all";
type RoleFilter = AppUserRole | "all";

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" }
];

const ROLE_FILTER_OPTIONS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All Roles" },
  { value: "admin", label: "Admin" },
  { value: "dba_admin", label: "DBA Admin" },
  { value: "operator", label: "Operator" },
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
  role: "operator",
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

  const activeCount = users.filter((user) => user.isActive).length;
  const adminCount = users.filter((user) => user.role === "admin" && user.isActive).length;

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
    <form onSubmit={mode === "create" ? handleCreate : handleEdit} className="space-y-5">
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
        <label className="flex min-h-10 items-center gap-3 self-end rounded-md border border-border/70 bg-background/30 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => updateForm("isActive", event.target.checked)}
            className="h-4 w-4 accent-red-500"
          />
          Active account
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => (mode === "create" ? setCreateOpen(false) : setEditOpen(false))}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create user" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-200">
            <ShieldCheck className="h-4 w-4" />
            Admin Panel
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Application users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage portal accounts, role access, and account status.
          </p>
        </div>
        <Button onClick={openCreate}>
          <UserPlus className="h-4 w-4" />
          Create user
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              Total users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{users.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Active accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Active admins</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{adminCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>User directory</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading users
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => {
                  const isSelf = currentUser?.userId === user.userId;
                  return (
                    <TableRow key={user.userId}>
                      <TableCell>
                        <div className="font-medium text-foreground">{user.username}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{user.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                          {roleLabel(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={user.isActive ? "outline" : "destructive"}>
                            {user.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {user.mustChangePassword && (
                            <Badge variant="secondary">Reset required</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(user.lastLoginAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(user.updatedAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleStatus(user)}
                            disabled={saving || isSelf}
                            title={isSelf ? "You cannot change your own status" : user.isActive ? "Deactivate user" : "Activate user"}
                          >
                            <Power className="h-4 w-4" />
                            {user.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openEdit(user)} disabled={saving}>
                            <Edit3 className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDelete(user)}
                            disabled={saving || isSelf}
                            title={isSelf ? "You cannot delete your own admin account" : "Permanently delete user"}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!filteredUsers.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create application user</DialogTitle>
            <DialogDescription>
              Set the initial password once. It is stored only as a salted hash.
            </DialogDescription>
          </DialogHeader>
          {renderUserForm("create")}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update application user</DialogTitle>
            <DialogDescription>
              Passwords are not visible here and cannot be reset from this panel.
            </DialogDescription>
          </DialogHeader>
          {renderUserForm("edit")}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user permanently</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The user <strong className="text-foreground">{deletingUser?.username}</strong> ({deletingUser?.email}) will be permanently removed from the database.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-medium">⚠ Warning</p>
            <p className="mt-1">All user data, sessions, and access will be permanently erased. This cannot be recovered.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
