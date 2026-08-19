"use client";

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import type { ShiftReportData, RebootHistoryItem } from "@/types/dba";
import { formatDateTime } from "@/lib/utils";

export type ExportFormat = "pdf" | "excel";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  align?: "left" | "center" | "right";
}

export interface ExportMeta {
  title: string;
  /** Audit: who triggered the export (app_admin username) */
  exportedBy: string;
  /** Date range applied to the dataset */
  periodLabel: string;
  /** Optional secondary filters applied (e.g. "DBA: alice, Shift: 1") */
  filterLabel?: string;
}

export interface UserShiftCountRow {
  username: string;
  role?: string;
  shift1_completed: number;
  shift2_completed: number;
  shift3_completed: number;
  shift4_completed: number;
  total_completed: number;
}

function timestampNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fileStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Replaces non-ASCII unicode characters with clean PDF-compatible ASCII symbols. */
export function sanitizePdfText(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/→/g, " to ")
    .replace(/←/g, " from ")
    .replace(/↔/g, " <-> ")
    .replace(/•/g, " | ")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/’/g, "'")
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/[^\x00-\x7F]/g, " ");
}

/** Converts HTML content to structured plain text for clean PDF export. */
export function stripHtml(html: string): string {
  if (!html) return "";
  if (!html.includes("<") && !html.includes("&")) return sanitizePdfText(html.trim());

  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, " - ");

  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Normalize line breaks & excessive space
  return sanitizePdfText(
    text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function shiftLabel(n: number): string {
  if (n === 1) return "Shift 1 (07:00-15:30)";
  if (n === 2) return "Shift 2 (14:30-23:00)";
  if (n === 3) return "Shift 3 (22:30-07:00)";
  if (n === 4) return "General Shift";
  return `Shift ${n}`;
}

export function exportDataset<T>(
  format: ExportFormat,
  columns: ExportColumn<T>[],
  rows: T[],
  meta: ExportMeta
): void {
  if (rows.length === 0) {
    toast.error("No data to export.");
    return;
  }
  if (format === "excel") {
    exportExcel(columns, rows, meta);
  } else {
    exportPdf(columns, rows, meta);
  }
}

// ── Excel Export ─────────────────────────────────────────────────────────────

function exportExcel<T>(columns: ExportColumn<T>[], rows: T[], meta: ExportMeta): void {
  const wb = XLSX.utils.book_new();

  const headerRow = columns.map((c) => c.header);
  const bodyRows = rows.map((r) => columns.map((c) => c.value(r) ?? ""));

  const auditRows: (string | number)[][] = [
    [meta.title],
    ["Exported By", meta.exportedBy],
    ["Exported At", timestampNow()],
    ["Period", meta.periodLabel],
    ["Filters", meta.filterLabel || "—"],
    [],
    headerRow,
    ...bodyRows
  ];

  const ws = XLSX.utils.aoa_to_sheet(auditRows);
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(14, c.header.length + 4) }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, headerRow.length - 1) } }];

  XLSX.utils.book_append_sheet(wb, ws, "Report");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  triggerDownload(blob, `${meta.title}-${fileStamp()}.xlsx`);
}

// ── PDF Styling Helpers ──────────────────────────────────────────────────────

function renderPdfHeader(doc: jsPDF, meta: ExportMeta): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top Accent Bar (Slate Navy + Cyan Stripe)
  doc.setFillColor(24, 43, 73); // Slate Navy
  doc.rect(0, 0, pageWidth, 6, "F");
  doc.setFillColor(14, 165, 233); // Cyan/Sky accent
  doc.rect(0, 6, pageWidth, 2.5, "F");

  // Portal Header Subtitle
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("ORACLE DBA OPERATIONS PORTAL | AUDIT & REPORTING", 40, 22);

  // Main Report Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(sanitizePdfText(meta.title), 40, 38);

  // Security Tag Box (Top Right)
  const rightX = pageWidth - 40;
  const tagWidth = 165;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(rightX - tagWidth, 18, tagWidth, 18, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("CLASSIFICATION: INTERNAL DBA USE ONLY", rightX - (tagWidth / 2), 29.5, { align: "center" });

  // Metadata Container Box
  const metaY = 48;
  const metaHeight = 36;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(40, metaY, pageWidth - 80, metaHeight, 4, 4, "FD");

  doc.setFontSize(8.5);

  // Left Metadata
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 116, 139);
  doc.text("Exported By:", 52, metaY + 14);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.text(sanitizePdfText(meta.exportedBy), 115, metaY + 14);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 116, 139);
  doc.text("Exported At:", 52, metaY + 26);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.text(timestampNow(), 115, metaY + 26);

  // Right Metadata
  const col2LabelX = pageWidth / 2 + 10;
  const col2ValueX = col2LabelX + 45;

  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 116, 139);
  doc.text("Period:", col2LabelX, metaY + 14);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.text(sanitizePdfText(meta.periodLabel), col2ValueX, metaY + 14);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 116, 139);
  doc.text("Filters:", col2LabelX, metaY + 26);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.text(sanitizePdfText(meta.filterLabel || "All Filters"), col2ValueX, metaY + 26);

  return metaY + metaHeight + 14;
}

function applyPageNumbersAndFooters(doc: jsPDF, mainTitle: string, generatedTimestamp: string): void {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Running Header for Pages 2+
    if (i > 1) {
      doc.setFillColor(24, 43, 73);
      doc.rect(0, 0, pageWidth, 4, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("ORACLE DBA OPERATIONS PORTAL", 40, 16);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(sanitizePdfText(mainTitle), pageWidth - 40, 16, { align: "right" });

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(40, 22, pageWidth - 40, 22);
    }

    // Footer Line
    const footerY = pageHeight - 20;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(40, footerY - 8, pageWidth - 40, footerY - 8);

    // Footer Text
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text("Generated by Oracle DBA Console", 40, footerY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, footerY, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(generatedTimestamp, pageWidth - 40, footerY, { align: "right" });
  }
}

// ── Single Dataset PDF Export ────────────────────────────────────────────────

function exportPdf<T>(columns: ExportColumn<T>[], rows: T[], meta: ExportMeta): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const startY = renderPdfHeader(doc, meta);
  const genTime = timestampNow();

  const head = [columns.map((c) => sanitizePdfText(c.header))];
  const body = rows.map((r) =>
    columns.map((c) => {
      const val = c.value(r);
      if (val === null || val === undefined) return "-";
      return sanitizePdfText(String(val));
    })
  );

  // Column alignments
  const columnStyles: Record<number, { halign: "left" | "center" | "right" }> = {};
  columns.forEach((col, idx) => {
    if (col.align) {
      columnStyles[idx] = { halign: col.align };
    }
  });

  autoTable(doc, {
    startY,
    head,
    body,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 4,
      overflow: "linebreak",
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.4
    },
    headStyles: {
      fillColor: [24, 43, 73],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      halign: "left"
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles,
    margin: { top: 32, bottom: 36, left: 40, right: 40 },
    didParseCell: (data) => {
      // Cell Status Highlights
      if (data.section === "body") {
        const text = String(data.cell.raw).trim();

        if (["COMPLIANT", "OK", "YES", "ACTIVE", "ACKNOWLEDGED", "100%"].includes(text)) {
          data.cell.styles.textColor = [21, 128, 61]; // green-700
          data.cell.styles.fontStyle = "bold";
        } else if (["NON_COMPLIANT", "FAIL", "NO"].includes(text)) {
          data.cell.styles.textColor = [185, 28, 28]; // red-700
          data.cell.styles.fontStyle = "bold";
        } else if (["PENDING"].includes(text)) {
          data.cell.styles.textColor = [180, 83, 9]; // amber-700
          data.cell.styles.fontStyle = "bold";
        }
      }
    }
  });

  applyPageNumbersAndFooters(doc, meta.title, genTime);
  doc.save(`${meta.title.toLowerCase().replace(/[^a-z0-9]/gi, "_")}_${fileStamp()}.pdf`);
}

// ── Full Executive Shift Report PDF Export ───────────────────────────────────

export function exportFullShiftReportPdf(
  report: ShiftReportData,
  userShiftCounts: UserShiftCountRow[],
  meta: ExportMeta
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const genTime = timestampNow();
  let currentY = renderPdfHeader(doc, meta);
  const pageWidth = doc.internal.pageSize.getWidth();

  const sectionHeader = (title: string) => {
    // Check space remaining on page, insert page break if needed
    if (currentY > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage();
      currentY = 36;
    }

    doc.setFillColor(24, 43, 73); // Slate Navy
    doc.roundedRect(40, currentY, pageWidth - 80, 20, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 48, currentY + 13);
    currentY += 26;
  };

  // ── Section 1: Executive Summary & Health ─────────────────────────────
  sectionHeader("1. EXECUTIVE SUMMARY & OPERATIONAL HEALTH");

  const overallComp = report.checklistCompletion.completion_pct;
  const dbComp = report.dbStatusCompletion.completion_pct;
  const backupComp = report.backupCompletion.completion_pct;
  const exceptionsCount = report.lateLogins.length + report.pendingHandovers.length;

  const kpiData = [
    [
      "Active DBAs Currently Logged In",
      `${report.activeDbas.length} DBAs (${report.dailyAttendance[0]?.unique_dbas ?? 0} unique today)`,
      "Checklist Compliance Rate",
      `${overallComp}% (${report.checklistCompletion.completed}/${report.checklistCompletion.total} checks)`
    ],
    [
      "Average Login Session Duration",
      `${(report.avgLoginDurationMin / 60).toFixed(1)} hrs`,
      "Total Exceptions / Alerts",
      `${exceptionsCount} (${report.lateLogins.length} late, ${report.pendingHandovers.length} pending HO)`
    ],
    [
      "DB Availability Check Rate",
      `${dbComp}% (${report.dbStatusCompletion.completed}/${report.dbStatusCompletion.total})`,
      "Backup Status Completion",
      `${backupComp}% (${report.backupCompletion.completed}/${report.backupCompletion.total})`
    ]
  ];

  autoTable(doc, {
    startY: currentY,
    body: kpiData,
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      lineWidth: 0.4
    },
    columnStyles: {
      0: { fontStyle: "bold", textColor: [71, 85, 105], fillColor: [248, 250, 252], cellWidth: 170 },
      1: { fontStyle: "bold", textColor: [15, 23, 42], cellWidth: 200 },
      2: { fontStyle: "bold", textColor: [71, 85, 105], fillColor: [248, 250, 252], cellWidth: 170 },
      3: { fontStyle: "bold", textColor: [15, 23, 42] }
    },
    margin: { left: 40, right: 40 }
  });

  currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // ── Section 2: User Completed Shifts Summary ──────────────────────────
  sectionHeader("2. USER COMPLETED SHIFTS BREAKDOWN");

  const shiftCountBody = userShiftCounts.map((u) => [
    u.username,
    u.role ? u.role.replace("_", " ") : "DBA",
    String(u.shift1_completed),
    String(u.shift2_completed),
    String(u.shift3_completed),
    String(u.shift4_completed),
    String(u.total_completed)
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [["User / DBA", "Role", "Morning Shift (S1)", "Afternoon Shift (S2)", "Night Shift (S3)", "General Shift", "Total Completed"]],
    body: shiftCountBody,
    styles: { font: "helvetica", fontSize: 8, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4 },
    headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
      6: { halign: "center", fontStyle: "bold", textColor: [14, 116, 144] }
    },
    margin: { left: 40, right: 40 }
  });

  currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // ── Section 3: Total Worked Hours per User ─────────────────────────────
  sectionHeader("3. TOTAL WORKED HOURS PER USER");

  const workHoursBody = report.userWorkHours.map((u) => {
    const hoursInt = Math.floor(u.total_minutes / 60);
    const minsRem = u.total_minutes % 60;
    const avgH = Math.floor(u.avg_session_minutes / 60);
    const avgM = u.avg_session_minutes % 60;
    const shiftBreakdown = `S1: ${u.shift1_hours}h | S2: ${u.shift2_hours}h | S3: ${u.shift3_hours}h | Gen: ${u.shift4_hours}h`;

    return [
      u.username,
      `${hoursInt}h ${minsRem}m (${u.total_hours} hrs)`,
      `${u.completed_sessions} completed ${u.active_sessions > 0 ? `(${u.active_sessions} active)` : ""}`,
      avgH > 0 ? `${avgH}h ${avgM}m` : `${avgM}m`,
      shiftBreakdown,
      u.last_login_at || "—"
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["DBA User", "Total Hours Worked", "Sessions", "Avg Session", "Shift Breakdown", "Last Login At"]],
    body: workHoursBody,
    styles: { font: "helvetica", fontSize: 8, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4 },
    headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      1: { fontStyle: "bold", textColor: [14, 116, 144] },
      3: { halign: "right" }
    },
    margin: { left: 40, right: 40 }
  });

  currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  // ── Section 4: Shift Coverage Analysis ────────────────────────────────
  if (report.coverage.length > 0) {
    sectionHeader("4. SHIFT COVERAGE ANALYSIS");

    const coverageBody = report.coverage.slice(0, 30).map((c) => {
      const covH = Math.floor(c.covered_minutes / 60);
      const covM = c.covered_minutes % 60;
      const gapH = Math.floor(c.gap_minutes / 60);
      const gapM = c.gap_minutes % 60;
      return [
        c.shift_date,
        `${covH}h ${covM}m`,
        c.gap_minutes > 0 ? `${gapH}h ${gapM}m` : "0",
        `${c.coverage_pct}%`,
        c.uncovered_shifts.length > 0 ? c.uncovered_shifts.map((sn) => `Shift ${sn}`).join(", ") : "None"
      ];
    });

    autoTable(doc, {
      startY: currentY,
      head: [["Shift Date", "Covered Time", "Gap Time", "Coverage %", "Uncovered Shifts"]],
      body: coverageBody,
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4 },
      headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "center", fontStyle: "bold" }
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const val = parseInt(String(data.cell.raw), 10);
          if (val >= 100) data.cell.styles.textColor = [21, 128, 61];
          else if (val >= 50) data.cell.styles.textColor = [180, 83, 9];
          else data.cell.styles.textColor = [185, 28, 28];
        }
      },
      margin: { left: 40, right: 40 }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

  // ── Section 5: PROD Database Availability Checklist ─────────────────
  if (report.dbStatusChecks.length > 0) {
    sectionHeader("5. PROD DATABASE AVAILABILITY CHECKLIST");

    const dbChecksBody = report.dbStatusChecks.map((r) => [
      r.shift_date,
      shiftLabel(r.shift_number),
      r.database_name,
      r.status,
      r.checked_username,
      r.checked_at,
      r.is_realtime_check ? "Yes" : "No",
      r.comment_text || "—"
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Shift Date", "Shift", "Database", "Status", "Checked By", "Checked At", "Realtime", "Comments"]],
      body: dbChecksBody,
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.4 },
      headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        3: { halign: "center" },
        6: { halign: "center" }
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const text = String(data.cell.raw);
          if (["OK", "COMPLIANT", "ONLINE"].includes(text)) data.cell.styles.textColor = [21, 128, 61];
          else data.cell.styles.textColor = [185, 28, 28];
        }
      },
      margin: { left: 40, right: 40 }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

  // ── Section 6: Backup Status Checklist ────────────────────────────────
  if (report.backupStatusChecks.length > 0) {
    sectionHeader("6. BACKUP STATUS CHECKLIST");

    const backupBody = report.backupStatusChecks.map((r) => [
      r.shift_date,
      shiftLabel(r.shift_number),
      r.database_name,
      r.backup_name,
      r.status,
      r.checked_username,
      r.checked_at,
      r.comment_text || "—"
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Shift Date", "Shift", "Database", "Backup", "Status", "Checked By", "Checked At", "Comments"]],
      body: backupBody,
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.4 },
      headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        4: { halign: "center" }
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          const text = String(data.cell.raw);
          if (["COMPLIANT", "OK", "SUCCESS"].includes(text)) data.cell.styles.textColor = [21, 128, 61];
          else data.cell.styles.textColor = [185, 28, 28];
        }
      },
      margin: { left: 40, right: 40 }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

  // ── Section 7: Late Logins & Exceptions ───────────────────────────────
  if (report.lateLogins.length > 0) {
    sectionHeader("7. LATE LOGINS & EXCEPTIONS");

    const lateBody = report.lateLogins.map((l) => [
      l.username,
      `Shift ${l.shift_number}`,
      l.shift_date,
      l.login_at,
      `+${l.minutes_late}m`,
      l.late_comment || "—"
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["DBA User", "Shift", "Shift Date", "Login Time", "Minutes Late", "Reason / Comment"]],
      body: lateBody,
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4 },
      headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        4: { halign: "right", fontStyle: "bold", textColor: [180, 83, 9] }
      },
      margin: { left: 40, right: 40 }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

  // ── Section 8: Shift Handover Notes ────────────────────────────────────
  if (report.handovers.length > 0) {
    sectionHeader("8. SHIFT HANDOVER NOTES SUMMARY");

    const handoverBody = report.handovers.map((h) => [
      h.shift_date,
      `Shift ${h.shift_number}`,
      h.author_username,
      h.status,
      h.ack_username ? `${h.ack_username} (${h.ack_at || ""})` : "Unacknowledged",
      stripHtml(h.handover_text || "")
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Shift Date", "Shift", "Author", "Status", "Acknowledged By", "Handover Notes"]],
      body: handoverBody,
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 4, lineColor: [226, 232, 240], lineWidth: 0.4 },
      headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        3: { halign: "center" },
        5: { cellWidth: 340 }
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const text = String(data.cell.raw);
          if (text === "ACKNOWLEDGED") data.cell.styles.textColor = [21, 128, 61];
          else data.cell.styles.textColor = [180, 83, 9];
        }
      },
      margin: { left: 40, right: 40 }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }

  // ── Section 9: Recent Shift Activity Timeline ──────────────────────────
  if (report.activityTimeline.length > 0) {
    sectionHeader("9. RECENT SHIFT ACTIVITY TIMELINE");

    const timelineBody = report.activityTimeline.slice(0, 50).map((t) => [
      t.session_id ? `#${t.session_id}` : "—",
      t.event,
      t.username,
      `Shift ${t.shift_number}`,
      t.timestamp,
      t.detail || "—"
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Session ID", "Event", "DBA User", "Shift", "Timestamp", "Detail / Activity"]],
      body: timelineBody,
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.4 },
      headStyles: { fillColor: [24, 43, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { fontStyle: "bold", halign: "center" },
        1: { fontStyle: "bold" },
        5: { cellWidth: 280 }
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 1) {
          const text = String(data.cell.raw);
          if (text === "login") data.cell.styles.textColor = [21, 128, 61];
          else if (text === "logout") data.cell.styles.textColor = [185, 28, 28];
          else if (text.includes("handover")) data.cell.styles.textColor = [126, 34, 206];
          else if (text === "acknowledge") data.cell.styles.textColor = [14, 116, 144];
        }
      },
      margin: { left: 40, right: 40 }
    });
  }

  applyPageNumbersAndFooters(doc, meta.title, genTime);
  doc.save(`full_executive_shift_report_${fileStamp()}.pdf`);
}

// ── Reboot History Audit Compliance PDF Export ───────────────────────────────

export function exportRebootHistoryPdf(
  items: RebootHistoryItem[],
  meta: ExportMeta & { dbName: string }
): void {
  if (!items || items.length === 0) {
    toast.error("No reboot history data to export.");
    return;
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const genTime = timestampNow();
  let currentY = renderPdfHeader(doc, meta);
  const pageWidth = doc.internal.pageSize.getWidth();

  // Summary Metrics calculation
  const total = items.length;
  const compliantCount = items.filter((i) => i.is_compliant).length;
  const nonCompliantCount = total - compliantCount;
  const compliantPct = total > 0 ? Math.round((compliantCount / total) * 100) : 100;
  const preShutdownCount = items.filter((i) => i.event_type === "PRE_SHUTDOWN").length;
  const startupCount = items.filter(
    (i) => i.event_type === "POST_MOUNT_COMPLIANT" || i.event_type === "POST_MOUNT_FAILED"
  ).length;

  // Summary KPI banner box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(40, currentY, pageWidth - 80, 32, 4, 4, "FD");

  const statCols = [
    { label: "Total Events", value: `${total}` },
    {
      label: "Audit Compliant",
      value: `${compliantCount} (${compliantPct}%)`,
      highlight: compliantPct === 100 ? "green" : "default"
    },
    {
      label: "Non-Compliant",
      value: `${nonCompliantCount}`,
      highlight: nonCompliantCount > 0 ? "red" : "default"
    },
    { label: "Pre-Shutdown Snapshots", value: `${preShutdownCount}` },
    { label: "Startup Mount Audits", value: `${startupCount}` }
  ];

  const colWidth = (pageWidth - 80) / statCols.length;
  statCols.forEach((col, idx) => {
    const colX = 40 + idx * colWidth + 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(col.label, colX, currentY + 12);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    if (col.highlight === "green") {
      doc.setTextColor(21, 128, 61);
    } else if (col.highlight === "red") {
      doc.setTextColor(185, 28, 28);
    } else {
      doc.setTextColor(15, 23, 42);
    }
    doc.text(col.value, colX, currentY + 24);
  });

  currentY += 42;

  const eventLabel = (type: string) => {
    if (type === "PRE_SHUTDOWN") return "Pre-Shutdown";
    if (type === "POST_MOUNT_COMPLIANT") return "Started (Compliant)";
    return "Startup Aborted";
  };

  const body = items.map((item) => {
    const paramDetails = [
      `spfile: ${item.spfile_value ? item.spfile_value : "(blank) [OK]"}`,
      `audit_sys_ops: ${item.audit_sys_ops || "—"}`,
      `audit_trail: ${item.audit_trail || "—"}`
    ].join("\n");

    const failureOrNotes = item.is_compliant
      ? "✓ All audit checks compliant"
      : sanitizePdfText(item.failure_reasons || "Non-compliant parameters detected");

    const timeStr = item.created_at
      ? formatDateTime(item.created_at)
      : (item.captured_at || "—");

    return [
      sanitizePdfText(timeStr),
      eventLabel(item.event_type),
      sanitizePdfText(item.requested_by || "system"),
      sanitizePdfText(item.shutdown_option || "—"),
      item.is_compliant ? "COMPLIANT" : "NON_COMPLIANT",
      paramDetails,
      failureOrNotes
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [[
      "Timestamp (IST)",
      "Event Type",
      "Requested By",
      "Mode / Option",
      "Compliance",
      "Captured V$PARAMETER Audit Values",
      "Failure Reasons / Audit Notes"
    ]],
    body,
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 4,
      lineColor: [226, 232, 240],
      lineWidth: 0.4,
      textColor: [30, 41, 59],
      overflow: "linebreak"
    },
    headStyles: {
      fillColor: [24, 43, 73],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      halign: "left"
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 105 },
      1: { cellWidth: 95 },
      2: { cellWidth: 80 },
      3: { cellWidth: 70 },
      4: { halign: "center", cellWidth: 80, fontStyle: "bold" },
      5: { cellWidth: 175, font: "courier", fontSize: 7 },
      6: { cellWidth: 155 }
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        if (data.column.index === 4) {
          const text = String(data.cell.raw);
          if (text === "COMPLIANT") {
            data.cell.styles.textColor = [21, 128, 61];
          } else {
            data.cell.styles.textColor = [185, 28, 28];
          }
        }
        if (data.column.index === 1) {
          const text = String(data.cell.raw);
          if (text.includes("Pre-Shutdown")) {
            data.cell.styles.textColor = [180, 83, 9];
          } else if (text.includes("Started")) {
            data.cell.styles.textColor = [21, 128, 61];
          } else if (text.includes("Aborted")) {
            data.cell.styles.textColor = [185, 28, 28];
          }
        }
      }
    },
    margin: { top: 32, bottom: 36, left: 40, right: 40 }
  });

  applyPageNumbersAndFooters(doc, meta.title, genTime);
  const cleanDb = meta.dbName.toLowerCase().replace(/[^a-z0-9]/gi, "_");
  doc.save(`reboot_history_${cleanDb}_${fileStamp()}.pdf`);
  toast.success("PDF report downloaded successfully.");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
