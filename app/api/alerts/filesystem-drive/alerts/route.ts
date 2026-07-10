import { NextResponse } from "next/server";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import {
  insertAlertNotification,
  insertAuditLog,
  findPendingAlertNotificationOccurrence,
  replacePendingAlertNotification
} from "@/lib/server/repository";
import type { AlertNotification, AlertNotificationSeverity, AlertNotificationStatus, DbaAlertLogSeverity } from "@/types/dba";

export const dynamic = "force-dynamic";

type BodyRecord = Record<string, unknown>;

const ALERT_TYPE = "filesystem_drive";
const PUBLIC_ALERT_ACTOR = "n8n";

function readString(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readNumber(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readObject(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as BodyRecord;
    }
  }
  return undefined;
}

function normalizeSeverity(raw: string, utilizationPct?: number, criticalPct = 90): AlertNotificationSeverity {
  const value = raw.toLowerCase();
  if (value === "info" || value === "warning" || value === "critical" || value === "error") return value;
  if (typeof utilizationPct === "number" && utilizationPct >= criticalPct) return "critical";
  return "warning";
}

function normalizeStatus(raw: string): AlertNotificationStatus {
  const value = raw.toLowerCase();
  if (
    value === "pending_approval" ||
    value === "approved" ||
    value === "rejected" ||
    value === "completed" ||
    value === "failed" ||
    value === "acknowledged"
  ) {
    return value;
  }
  return "pending_approval";
}

function createAlertId(index: number) {
  return `FS-${Date.now()}-${index}-${Math.floor(Math.random() * 1000)}`;
}

function createBatchId() {
  return `FSBATCH-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function fsSeverityToAlertLogSeverity(severity: AlertNotificationSeverity): DbaAlertLogSeverity {
  return severity === "critical" || severity === "error" ? "P2" : "INFO";
}

function collectItems(body: BodyRecord) {
  for (const key of ["items", "violations", "filesystems", "drives", "alerts"]) {
    const value = body[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is BodyRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [body];
}

function buildTargetName(body: BodyRecord) {
  return readString(body, [
    "object_name",
    "objectName",
    "filesystem",
    "file_system",
    "mount_point",
    "mountPoint",
    "mount",
    "drive",
    "path",
    "name"
  ]);
}

function buildMetadata(item: BodyRecord, merged: BodyRecord, batchId: string, workflowRunId?: string) {
  const metadata = readObject(merged, ["metadata", "raw", "payload"]) || {};
  const freePct = readNumber(merged, ["free_pct", "freePct", "pct_free", "pctFree"]);
  const sizeGb = readNumber(merged, ["size_gb", "sizeGb", "total_gb", "totalGb", "size"]);
  const os = readString(merged, ["os", "operating_system", "operatingSystem"]);
  const host = readString(merged, ["host", "hostname", "server"]);
  const drive = readString(merged, ["drive"]);
  const mountPoint = readString(merged, ["mount_point", "mountPoint", "mount"]);
  const filesystem = readString(merged, ["filesystem", "file_system"]);

  return {
    ...metadata,
    ...(os ? { os } : {}),
    ...(host ? { host } : {}),
    ...(drive ? { drive } : {}),
    ...(mountPoint ? { mount_point: mountPoint } : {}),
    ...(filesystem ? { filesystem } : {}),
    ...(typeof freePct === "number" ? { free_pct: freePct } : {}),
    ...(typeof sizeGb === "number" ? { size_gb: sizeGb } : {}),
    batch_id: batchId,
    ...(workflowRunId ? { workflow_run_id: workflowRunId } : {}),
    source_payload: item
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BodyRecord;
    const items = collectItems(body);

    if (!items.length) {
      return NextResponse.json({ message: "At least one filesystem/drive alert item is required." }, { status: 400 });
    }

    const topDb = readString(body, ["db", "database", "db_name", "dbName"]);
    const topWorkflowRunId = readString(body, ["workflow_run_id", "workflowRunId", "execution_id", "executionId"]);
    const topActor =
      readString(body, ["created_by", "createdBy", "requested_by", "requestedBy", "actor"]) || PUBLIC_ALERT_ACTOR;
    const batchId = createBatchId();

    const created: AlertNotification[] = [];
    const refreshed: AlertNotification[] = [];
    const perItemErrors: Array<{ index: number; message: string }> = [];

    for (const [index, item] of items.entries()) {
      const merged = { ...body, ...item };
      const db = readString(merged, ["db", "database", "db_name", "dbName"]) || topDb;
      const target = buildTargetName(merged);

      if (!db || !target) {
        perItemErrors.push({
          index: index + 1,
          message: `Alert item ${index + 1} must include db and filesystem/drive name.`
        });
        continue;
      }

      const utilizationPct = readNumber(merged, [
        "utilization_pct",
        "utilizationPct",
        "pct_used",
        "pctUsed",
        "used_pct",
        "usedPct"
      ]);
      const thresholdPct = readNumber(merged, ["threshold_pct", "thresholdPct", "threshold"]) ?? 90;
      const criticalPct =
        readNumber(merged, ["critical_pct", "criticalPct", "critical_threshold_pct", "criticalThresholdPct"]) ??
        thresholdPct;
      const usedGb = readNumber(merged, ["used_gb", "usedGb", "used"]);
      const freeGb = readNumber(merged, ["free_gb", "freeGb", "free"]);
      const message =
        readString(merged, ["message", "description", "detail"]) ||
        `${target} utilization is ${typeof utilizationPct === "number" ? `${utilizationPct}%` : "above threshold"} on ${db}.`;
      const actor =
        readString(merged, ["created_by", "createdBy", "requested_by", "requestedBy", "actor"]) || topActor;
      const incomingAlertId = readString(merged, ["id", "alert_id", "alertId"]);
      const workflowRunId =
        readString(merged, ["workflow_run_id", "workflowRunId", "execution_id", "executionId"]) || topWorkflowRunId;
      const metadata = buildMetadata(item, merged, batchId, workflowRunId || undefined);

      const idempotencyKey = `${ALERT_TYPE}|${db}|${target}`;

      const pendingOccurrence = await findPendingAlertNotificationOccurrence({
        db,
        alertType: ALERT_TYPE,
        objectName: target
      });

      if (pendingOccurrence) {
        const alert = await replacePendingAlertNotification({
          id: pendingOccurrence.id,
          source: readString(merged, ["source"]) || "n8n",
          alertType: ALERT_TYPE,
          db,
          objectName: target,
          severity: normalizeSeverity(readString(merged, ["severity", "level"]), utilizationPct, criticalPct),
          status: "pending_approval",
          message,
          utilizationPct,
          thresholdPct,
          criticalPct,
          usedGb,
          freeGb,
          workflowRunId,
          createdBy: actor,
          metadata: {
            ...metadata,
            refreshed_from_alert_id: pendingOccurrence.id,
            refreshed_at: new Date().toISOString()
          }
        });

        await insertAuditLog({
          actor,
          action: "disk_utilization",
          db,
          status: alert.status,
          detail: `${ALERT_TYPE} alert ${alert.id} refreshed for ${target}.`,
          metadata: {
            alert_id: alert.id,
            alert_type: alert.alert_type,
            batch_id: batchId,
            public_endpoint: true,
            refreshed: true
          }
        });

        emitAlertNotificationEvent("updated", alert);

        emitGlobalNotification({
          id: alert.id,
          type: "filesystem_drive",
          severity: alert.severity,
          db: alert.db,
          title: `Filesystem ${alert.severity.toUpperCase()}: ${target}`,
          message: alert.message,
          timestamp: alert.created_at,
          targetPath: "/filesystem-drive"
        });

        refreshed.push(alert);
        continue;
      }

      const alertId = incomingAlertId ? (items.length === 1 ? incomingAlertId : `${incomingAlertId}-${index + 1}`) : createAlertId(index + 1);

      const alert = await insertAlertNotification({
        id: alertId,
        source: readString(merged, ["source"]) || "n8n",
        alertType: ALERT_TYPE,
        db,
        objectName: target,
        severity: normalizeSeverity(readString(merged, ["severity", "level"]), utilizationPct, criticalPct),
        status: normalizeStatus(readString(merged, ["status", "state"]) || "pending_approval"),
        message,
        utilizationPct,
        thresholdPct,
        criticalPct,
        usedGb,
        freeGb,
        workflowRunId,
        createdBy: actor,
        metadata: {
          ...metadata,
          idempotency_key: idempotencyKey
        }
      });

      await insertAuditLog({
        actor,
        action: "disk_utilization",
        db,
        status: alert.status,
        detail: `${ALERT_TYPE} alert ${alert.id} created for ${target}.`,
        metadata: {
          alert_id: alert.id,
          alert_type: alert.alert_type,
          batch_id: batchId,
          public_endpoint: true
        }
      });

      emitAlertNotificationEvent("created", alert);

      emitGlobalNotification({
        id: alert.id,
        type: "filesystem_drive",
        severity: alert.severity,
        db: alert.db,
        title: `Filesystem ${alert.severity.toUpperCase()}: ${target}`,
        message: alert.message,
        timestamp: alert.created_at,
        targetPath: "/filesystem-drive"
      });

      created.push(alert);
    }

    return NextResponse.json(
      {
        batch_id: batchId,
        items: [...created, ...refreshed],
        created: created.length,
        refreshed: refreshed.length,
        count: created.length + refreshed.length,
        ...(perItemErrors.length ? { errors: perItemErrors } : {})
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected filesystem/drive alert create error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}