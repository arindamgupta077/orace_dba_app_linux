"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Database,
  Edit3,
  Filter,
  Loader2,
  Plus,
  Power,
  RotateCcw,
  Search,
  Trash2,
  User,
  X
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { fetchChangeAuditLogs } from "@/services/api";
import type { ChangeAuditEntry } from "@/services/api";

interface ChangeHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "DATABASE_INVENTORY" | "APP_USER";
}

function formatTimestamp(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function ActionBadge({ action }: { action: ChangeAuditEntry["action"] }) {
  switch (action) {
    case "CREATE":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 font-medium text-xs"
        >
          <Plus className="h-3 w-3" />
          Create
        </Badge>
      );
    case "UPDATE":
      return (
        <Badge
          variant="outline"
          className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1 font-medium text-xs"
        >
          <Edit3 className="h-3 w-3" />
          Update
        </Badge>
      );
    case "DELETE":
      return (
        <Badge
          variant="outline"
          className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 gap-1 font-medium text-xs"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </Badge>
      );
    case "TOGGLE_STATUS":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 font-medium text-xs"
        >
          <Power className="h-3 w-3" />
          Toggle
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-xs">
          {action}
        </Badge>
      );
  }
}

function FieldLabel({ field }: { field: string }) {
  const labels: Record<string, string> = {
    database_name: "Database Name",
    environment: "Environment",
    location: "Location",
    operating_system: "OS",
    database_role: "DB Role",
    database_type: "DB Type",
    status: "Status",
    environment_label: "Env Label",
    owner_id: "Owner ID",
    server_name: "Host Name",
    server_ip: "Server IP",
    zone: "Zone",
    server_type: "Server Type",
    db_version: "DB Version",
    db_edition: "DB Edition",
    database_instance: "DB Instance",
    db_port: "DB Port",
    division: "Division",
    username: "Username",
    email: "Email",
    role: "Role",
    is_active: "Active"
  };
  return <span className="font-medium text-muted-foreground">{labels[field] || field}</span>;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function ChangeHistoryModal({ open, onOpenChange, entityType }: ChangeHistoryModalProps) {
  const [items, setItems] = useState<ChangeAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const title = entityType === "DATABASE_INVENTORY" ? "DB Inventory Change History" : "User Management Change History";
  const icon = entityType === "DATABASE_INVENTORY" ? Database : User;
  const Icon = icon;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchChangeAuditLogs(entityType, 1000);
      setItems(response.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    if (open) {
      void loadData();
    }
  }, [open, loadData]);

  // Reset page to 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [query, actionFilter, pageSize]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Action type filter
      if (actionFilter !== "ALL" && item.action !== actionFilter) {
        return false;
      }

      // 2. Search query filter
      const normalized = query.trim().toLowerCase();
      if (normalized) {
        const matches = [
          item.entityName,
          item.action,
          item.changedBy,
          item.fieldName,
          item.oldValue,
          item.newValue,
          item.changeSummary
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized);
        if (!matches) return false;
      }

      return true;
    });
  }, [items, query, actionFilter]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [filteredItems, safeCurrentPage, pageSize]);

  const startRecord = filteredItems.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endRecord = Math.min(safeCurrentPage * pageSize, filteredItems.length);

  const hasActiveFilters = query.trim() !== "" || actionFilter !== "ALL";

  const handleResetFilters = () => {
    setQuery("");
    setActionFilter("ALL");
    setCurrentPage(1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-lg pr-6">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 ring-1 ring-violet-500/30">
                <Clock className="h-4 w-4 text-violet-400" />
              </div>
              <span>{title}</span>
              {!loading && (
                <Badge variant="secondary" className="ml-2 text-xs font-normal">
                  {filteredItems.length} record{filteredItems.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Filters Row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between my-1">
          <div className="flex flex-1 items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, user, field, value..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 pr-8 h-9 text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Action Filter Select */}
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <div className="flex items-center gap-1.5 truncate">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Action" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Actions</SelectItem>
                <SelectItem value="CREATE">Create</SelectItem>
                <SelectItem value="UPDATE">Update</SelectItem>
                <SelectItem value="DELETE">Delete</SelectItem>
                {entityType === "APP_USER" && <SelectItem value="TOGGLE_STATUS">Toggle Status</SelectItem>}
              </SelectContent>
            </Select>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                title="Reset filters"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            )}
          </div>

          {/* Page Size Selector */}
          <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-muted-foreground">
            <span>Rows per page:</span>
            <Select value={String(pageSize)} onValueChange={(val) => setPageSize(Number(val))}>
              <SelectTrigger className="w-[70px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto rounded-md border border-border/50 bg-background/30 min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading change history…</span>
            </div>
          ) : paginatedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Icon className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">{hasActiveFilters ? "No matching records found." : "No change history recorded yet."}</p>
              {hasActiveFilters && (
                <Button variant="link" size="sm" onClick={handleResetFilters} className="mt-2 text-xs text-cyan-400">
                  Reset filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap w-[160px]">When</TableHead>
                  <TableHead className="whitespace-nowrap w-[120px]">Who</TableHead>
                  <TableHead className="whitespace-nowrap w-[100px]">Action</TableHead>
                  <TableHead className="whitespace-nowrap">
                    {entityType === "DATABASE_INVENTORY" ? "Database" : "User"}
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Change Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((item) => (
                  <TableRow key={item.changeId} className="group">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap font-mono tabular-nums">
                      {formatTimestamp(item.changedAt)}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm font-medium truncate max-w-[120px] block cursor-default">
                              {item.changedBy}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>Changed by: {item.changedBy}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={item.action} />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{item.entityName}</span>
                    </TableCell>
                    <TableCell>
                      {item.fieldName ? (
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                          <FieldLabel field={item.fieldName} />
                          {item.oldValue && (
                            <span className="inline-flex items-center rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400 line-through">
                              {item.oldValue.length > 40 ? item.oldValue.slice(0, 40) + "…" : item.oldValue}
                            </span>
                          )}
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          {item.newValue && (
                            <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                              {item.newValue.length > 40 ? item.newValue.slice(0, 40) + "…" : item.newValue}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {item.changeSummary || "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Footer Pagination Controls */}
        {!loading && filteredItems.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-border/50 text-xs text-muted-foreground">
            <div>
              Showing <span className="font-semibold text-foreground">{startRecord}</span> to{" "}
              <span className="font-semibold text-foreground">{endRecord}</span> of{" "}
              <span className="font-semibold text-foreground">{filteredItems.length}</span> records
            </div>

            <div className="flex items-center gap-1 self-end sm:self-auto">
              <span className="mr-2 text-xs">
                Page <span className="font-semibold text-foreground">{safeCurrentPage}</span> of{" "}
                <span className="font-semibold text-foreground">{totalPages}</span>
              </span>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage === 1}
                title="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={safeCurrentPage === 1}
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={safeCurrentPage === totalPages}
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safeCurrentPage === totalPages}
                title="Last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
