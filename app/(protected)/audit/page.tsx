"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Download, RotateCcw, Search, StickyNote, ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import { useAppStore } from "@/store/use-app-store";
import { exportDataset, ExportColumn } from "@/lib/export";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAuditLogs } from "@/services/api";
import type { AuditLogItem } from "@/types/dba";
import { StatusBadge } from "@/components/visual/status-badge";
import { downloadText, formatDateTime, toCsv, parseAppTimestamp, toIstDateString } from "@/lib/utils";

export default function AuditPage() {
  const user = useAppStore((state) => state.user);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters & Pagination State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [dbFilter, setDbFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(() => toIstDateString());
  const [appliedFromDate, setAppliedFromDate] = useState("");
  const [appliedToDate, setAppliedToDate] = useState(() => toIstDateString());
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [hasMore, setHasMore] = useState(true);

  const getSortOrder = (item: AuditLogItem) => {
    const status = item.status.toLowerCase();
    const detail = item.detail.toLowerCase();
    if (status === "pending" || status === "pending_approval" || status === "open") return 0;
    if (status === "acknowledged") return 1;
    if (status === "approved") {
      if (detail.includes("marked approved")) return 2;
      if (detail.includes("sql approved")) return 3;
      return 4;
    }
    if (status === "rejected" || status === "completed" || status === "failed" || status === "error") {
      return 5;
    }
    if (status === "resolved") return 9;
    return 7;
  };

  const processAndSortLogs = (items: AuditLogItem[]) => {
    const mappedItems = items.map(item => ({
      ...item,
      actor: item.actor === "n8n" ? "Monitoring Agent" : item.actor
    }));
    return mappedItems.sort((a, b) => {
      const dateA = formatDateTime(a.timestamp);
      const dateB = formatDateTime(b.timestamp);
      if (dateA === dateB) {
        const orderA = getSortOrder(a);
        const orderB = getSortOrder(b);
        if (orderA !== orderB) {
          return orderB - orderA;
        }
        const idA = parseInt(a.id.replace("AUD-", ""), 10) || 0;
        const idB = parseInt(b.id.replace("AUD-", ""), 10) || 0;
        return idB - idA;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const isDateFiltered = appliedFromDate !== "" || appliedToDate !== toIstDateString();
        const limitVal = isDateFiltered ? "unlimited" : 200;
        const response = await fetchAuditLogs({
          limit: limitVal,
          offset: 0,
          startDate: appliedFromDate || undefined,
          endDate: appliedToDate || undefined
        });
        if (!active) return;
        
        const sorted = processAndSortLogs(response.items || []);
        setAuditLogs(sorted);
        setHasMore(!isDateFiltered && (response.items || []).length === 200);
        setCurrentPage(1);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load audit logs.";
        toast.error("Could not load audit logs", { description: message });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [appliedFromDate, appliedToDate]);

  // Reset to first page when other filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, actorFilter, dbFilter, actionFilter]);

  const uniqueStatuses = Array.from(new Set(auditLogs.map((l) => l.status)));
  const uniqueActors = Array.from(new Set(auditLogs.map((l) => l.actor).filter((actor): actor is string => !!actor)));
  const uniqueDbs = Array.from(new Set(auditLogs.map((l) => l.db).filter((db): db is string => !!db))).sort();
  const uniqueActions = Array.from(new Set(auditLogs.map((l) => l.action).filter((action): action is string => !!action))).sort();

  const filteredLogs = auditLogs.filter((item) => {
    const matchesSearch =
      item.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.db?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      item.detail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.sql_command?.toLowerCase() || "").includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesActor = actorFilter === "all" || item.actor === actorFilter;
    const matchesDb = dbFilter === "all" || item.db === dbFilter;
    const matchesAction = actionFilter === "all" || item.action === actionFilter;

    let matchesDateRange = true;
    if (appliedFromDate || appliedToDate) {
      const itemDateStr = toIstDateString(parseAppTimestamp(item.timestamp));
      if (appliedFromDate && itemDateStr < appliedFromDate) {
        matchesDateRange = false;
      }
      if (appliedToDate && itemDateStr > appliedToDate) {
        matchesDateRange = false;
      }
    }

    return matchesSearch && matchesStatus && matchesActor && matchesDb && matchesAction && matchesDateRange;
  });

  const [sqlCommandOpen, setSqlCommandOpen] = useState<AuditLogItem | null>(null);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage) || 1;
  const currentLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleNextPage = async () => {
    if (currentPage === totalPages && hasMore) {
      try {
        setLoading(true);
        const response = await fetchAuditLogs({
          limit: 200,
          offset: auditLogs.length
        });
        
        const newSorted = processAndSortLogs(response.items || []);
        
        setAuditLogs(prev => {
          const merged = [...prev, ...newSorted];
          // Remove duplicates
          const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
          return processAndSortLogs(unique);
        });
        
        setHasMore((response.items || []).length === 200);
        setCurrentPage(p => p + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load more audit logs.";
        toast.error("Could not load more logs", { description: message });
      } finally {
        setLoading(false);
      }
    } else if (currentPage < totalPages) {
      setCurrentPage(p => p + 1);
    }
  };

  const getStatusType = (status: string) => {
    const s = status.toLowerCase();
    if (["error", "failed", "rejected", "critical"].includes(s)) return "critical";
    if (["success", "completed", "healthy", "approved", "done", "resolved"].includes(s)) return "healthy";
    if (["pending", "pending_approval", "warning", "running", "open"].includes(s)) return "warning";
    if (["acknowledged"].includes(s)) return "acknowledged";
    return "unknown";
  };

  const handleExport = (format: "excel" | "pdf") => {
    const columns: ExportColumn<AuditLogItem>[] = [
      { header: "Timestamp", value: (row) => formatDateTime(row.timestamp) },
      { header: "Actor", value: (row) => row.actor },
      { header: "Action", value: (row) => row.action },
      { header: "Database", value: (row) => row.db || "—" },
      { header: "Status", value: (row) => row.status },
      { header: "Detail", value: (row) => row.detail }
    ];

    const periodLabel = appliedFromDate || appliedToDate
      ? `${appliedFromDate || "Start"} to ${appliedToDate || "End"}`
      : "All time";

    const activeFilters = [];
    if (statusFilter !== "all") activeFilters.push(`Status: ${statusFilter}`);
    if (actorFilter !== "all") activeFilters.push(`Actor: ${actorFilter}`);
    if (dbFilter !== "all") activeFilters.push(`DB: ${dbFilter}`);
    if (actionFilter !== "all") activeFilters.push(`Action: ${actionFilter}`);
    if (searchTerm) activeFilters.push(`Search: "${searchTerm}"`);
    const filterLabel = activeFilters.join(", ") || "None";

    exportDataset(format, columns, filteredLogs, {
      title: "Operations Audit Logs",
      exportedBy: user?.username || "System",
      periodLabel,
      filterLabel
    });
  };

  return (
    <>
      <PageHeader title="Audit Logs" description="Role-aware activity trail for DBA actions, retries, approvals, and authentication events." icon={ClipboardList} />
      <Card>
        <CardContent className="space-y-6 pt-6">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3 sm:p-4">
            <div className="flex-1 min-w-[180px] xl:min-w-[240px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search logs..."
                  className="pl-8 bg-background"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            
            <div className="w-[calc(50%-0.375rem)] sm:w-[130px] xl:w-[150px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {uniqueStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[calc(50%-0.375rem)] sm:w-[130px] xl:w-[150px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Actor</label>
              <Select value={actorFilter} onValueChange={setActorFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Actors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actors</SelectItem>
                  {uniqueActors.map((actor) => (
                    <SelectItem key={actor} value={actor}>
                      {actor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[calc(50%-0.375rem)] sm:w-[130px] xl:w-[150px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Database</label>
              <Select value={dbFilter} onValueChange={setDbFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Databases" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Databases</SelectItem>
                  {uniqueDbs.map((db) => (
                    <SelectItem key={db} value={db}>
                      {db}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[calc(50%-0.375rem)] sm:w-[130px] xl:w-[150px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {uniqueActions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[calc(50%-0.375rem)] sm:w-[130px] xl:w-[150px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">From Date</label>
              <Input
                type="date"
                className="bg-background"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div className="w-[calc(50%-0.375rem)] sm:w-[130px] xl:w-[150px] space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">To Date</label>
              <Input
                type="date"
                className="bg-background"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="flex items-end pb-[1px]">
              <Button
                variant="secondary"
                onClick={() => {
                  setAppliedFromDate(fromDate);
                  setAppliedToDate(toDate);
                }}
                className="h-10 bg-primary/10 hover:bg-primary/20 text-primary"
              >
                Apply
              </Button>
            </div>

            {(searchTerm || statusFilter !== "all" || actorFilter !== "all" || dbFilter !== "all" || actionFilter !== "all" || appliedFromDate || appliedToDate !== toIstDateString() || fromDate || toDate !== toIstDateString()) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  setActorFilter("all");
                  setDbFilter("all");
                  setActionFilter("all");
                  setFromDate("");
                  setToDate(toIstDateString());
                  setAppliedFromDate("");
                  setAppliedToDate(toIstDateString());
                }}
                className="h-10 w-10 text-muted-foreground hover:text-foreground animate-in fade-in duration-200"
                title="Reset filters"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}

            <div className="ml-auto w-full sm:w-auto flex justify-end mt-2 sm:mt-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-10 w-10 bg-background" title="Export Logs">
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Export Formats</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("excel")} className="cursor-pointer">
                    <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-500" />
                    Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")} className="cursor-pointer">
                    <FileText className="mr-2 h-4 w-4 text-rose-500" />
                    PDF (.pdf)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadText("oracle-dba-audit.csv", toCsv(filteredLogs), "text/csv")} className="cursor-pointer">
                    <FileText className="mr-2 h-4 w-4 text-blue-500" />
                    CSV (.csv)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="font-semibold text-foreground/80">Timestamp</TableHead>
                <TableHead className="font-semibold text-foreground/80">Actor</TableHead>
                <TableHead className="font-semibold text-foreground/80">Action</TableHead>
                <TableHead className="font-semibold text-foreground/80">DB</TableHead>
                <TableHead className="font-semibold text-foreground/80">Status</TableHead>
                <TableHead className="font-semibold text-foreground/80">Detail</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 20 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-full max-w-sm" /></TableCell>
                    <TableCell><Skeleton className="h-7 w-7 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : currentLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : null}
              {currentLogs.map((item) => (
                <TableRow key={item.id} className="hover:bg-muted/20">
                  <TableCell className="whitespace-nowrap font-medium text-muted-foreground">
                    {formatDateTime(item.timestamp)}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {item.actor === "Monitoring Agent" ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {item.actor}
                      </span>
                    ) : (
                      <span className="text-foreground/90">{item.actor}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted border border-border/40 text-foreground/80 font-medium">
                      {item.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    {item.db ? (
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {item.db}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={getStatusType(item.status)}>{item.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="max-w-[200px] lg:max-w-[300px] xl:max-w-lg text-muted-foreground leading-relaxed break-words">{item.detail}</TableCell>
                  <TableCell>
                    {item.sql_command && item.status.toLowerCase() !== "pending_approval" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        aria-label="View SQL command"
                        title="View SQL command"
                        onClick={() => setSqlCommandOpen(item)}
                      >
                        <StickyNote className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {totalPages > 1 && (
            <div className="flex items-center justify-between space-x-2 py-4">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length} entries
              </div>
              <div className="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages && !hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!sqlCommandOpen} onOpenChange={(open) => !open && setSqlCommandOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>SQL command</DialogTitle>
            <DialogDescription>
              {sqlCommandOpen ? `Action: ${sqlCommandOpen.action}${sqlCommandOpen.db ? ` • DB: ${sqlCommandOpen.db}` : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words">
            {sqlCommandOpen?.sql_command || ""}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
