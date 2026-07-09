"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Download, Search, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAuditLogs } from "@/services/api";
import type { AuditLogItem } from "@/types/dba";
import { StatusBadge } from "@/components/visual/status-badge";
import { downloadText, formatDateTime, toCsv } from "@/lib/utils";

export default function AuditPage() {
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters & Pagination State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetchAuditLogs(300);
        if (!active) return;
        setAuditLogs(response.items);
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
  }, []);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, actorFilter]);

  const uniqueStatuses = Array.from(new Set(auditLogs.map((l) => l.status)));
  const uniqueActors = Array.from(new Set(auditLogs.map((l) => l.actor))).filter(Boolean);

  const filteredLogs = auditLogs.filter((item) => {
    const matchesSearch =
      item.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.db?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      item.detail.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesActor = actorFilter === "all" || item.actor === actorFilter;
    return matchesSearch && matchesStatus && matchesActor;
  });

  const [sqlCommandOpen, setSqlCommandOpen] = useState<AuditLogItem | null>(null);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const currentLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getStatusType = (status: string) => {
    const s = status.toLowerCase();
    if (["error", "failed", "rejected", "critical"].includes(s)) return "critical";
    if (["success", "completed", "healthy", "approved", "done"].includes(s)) return "healthy";
    if (["pending", "pending_approval", "warning", "running"].includes(s)) return "warning";
    return "unknown";
  };

  return (
    <>
      <PageHeader title="Audit Logs" description="Role-aware activity trail for DBA actions, retries, approvals, and authentication events." icon={ClipboardList} />
      <Card>
        <CardHeader className="flex-col items-start gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Operations Audit</CardTitle>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search logs..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by status" />
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
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by actor" />
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
            <Button variant="outline" onClick={() => downloadText("oracle-dba-audit.csv", toCsv(filteredLogs), "text/csv")}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>DB</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Loading audit logs...
                  </TableCell>
                </TableRow>
              ) : currentLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : null}
              {currentLogs.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(item.timestamp)}</TableCell>
                  <TableCell>{item.actor}</TableCell>
                  <TableCell className="font-mono">{item.action}</TableCell>
                  <TableCell>{item.db || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={getStatusType(item.status)}>{item.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="max-w-lg text-muted-foreground">{item.detail}</TableCell>
                  <TableCell>
                    {item.sql_command ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
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
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
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
