import "server-only";

import type { DbaAction, DbaResponse } from "@/types/dba";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapN8nItem(value: unknown) {
  if (isRecord(value) && "json" in value) {
    return value.json;
  }
  return value;
}

function toRecordArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const rows = value.map(unwrapN8nItem).filter(isRecord);
  return rows.length ? rows : undefined;
}

const INDICATOR_KEYS = new Set(["success", "ok", "done", "completed"]);

function isStatusIndicatorRow(row: JsonRecord): boolean {
  return Array.from(INDICATOR_KEYS).some((k) => typeof row[k] === "boolean");
}

function firstRowsArray(record: JsonRecord) {
  const rawData = isRecord(record.raw_data) ? record.raw_data : undefined;
  const nestedRecords = [record.result, record.body, record.response].filter(isRecord);

  for (const value of [
    record.rows,
    record.data,
    record.items,
    rawData?.rows,
    rawData?.data,
    ...nestedRecords.flatMap((nested) => [nested.rows, nested.data, nested.items])
  ]) {
    const rows = toRecordArray(value);
    if (rows) return rows;
  }

  return undefined;
}

function hasTextOutput(record: JsonRecord) {
  return ["raw_output", "rawOutput", "output", "stdout", "stderr", "text", "content", "file_content", "fileContent", "log", "logs"].some(
    (key) => typeof record[key] === "string" && String(record[key]).trim()
  );
}

function collectRows(input: unknown) {
  if (Array.isArray(input)) {
    const rows: JsonRecord[] = [];
    for (const item of input.map(unwrapN8nItem)) {
      if (Array.isArray(item)) {
        const nestedRows = toRecordArray(item);
        if (nestedRows) rows.push(...nestedRows);
        continue;
      }
      if (!isRecord(item)) continue;
      const nestedRows = firstRowsArray(item);
      if (nestedRows) {
        rows.push(...nestedRows);
      } else if (!hasTextOutput(item)) {
        rows.push(item);
      }
    }
    return rows;
  }

  if (isRecord(input)) {
    return firstRowsArray(input) || [];
  }

  return [];
}

function readTextOutput(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";

  const unwrapped = unwrapN8nItem(value);

  if (typeof unwrapped === "string") return unwrapped;
  if (typeof unwrapped === "number" || typeof unwrapped === "boolean") return String(unwrapped);

  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map((item) => readTextOutput(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }

  if (!isRecord(unwrapped)) return "";

  const rawData = isRecord(unwrapped.raw_data) ? unwrapped.raw_data : undefined;
  const nestedRecords = [unwrapped.result, unwrapped.body, unwrapped.response].filter(isRecord);

  for (const source of [unwrapped, rawData, ...nestedRecords]) {
    if (!source) continue;
    for (const key of ["raw_output", "rawOutput", "output", "stdout", "stderr", "text", "content", "file_content", "fileContent", "listener_ora", "tnsnames_ora", "log", "logs"]) {
      const output = readTextOutput(source[key], depth + 1);
      if (output) return output;
    }
  }

  return "";
}

export function normalizeDbaResponse(input: unknown, action: DbaAction): DbaResponse {
  const isArrayInput = Array.isArray(input);
  const payload = !isArrayInput && input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const status = payload.status === "pending_approval" || payload.status === "error" ? payload.status : "success";

  const rawData: DbaResponse["raw_data"] =
    payload.raw_data && typeof payload.raw_data === "object"
      ? { ...(payload.raw_data as DbaResponse["raw_data"]) }
      : {};

  if (Array.isArray(rawData.backups)) {
    const realBackups = (rawData.backups as unknown[])
      .map(unwrapN8nItem)
      .filter(isRecord)
      .filter((r) => !isStatusIndicatorRow(r));
    if (realBackups.length > 0) {
      rawData.backups = realBackups as unknown as DbaResponse["raw_data"]["backups"];
    } else {
      delete rawData.backups;
    }
  }

  const rows = collectRows(input);
  const textOutput = readTextOutput(input);

  const effectiveRows: JsonRecord[] =
    rows.length > 0
      ? rows
      : isArrayInput
        ? (input as unknown[]).map(unwrapN8nItem).filter(isRecord)
        : [];

  const dataRows = effectiveRows.filter((r) => !isStatusIndicatorRow(r));

  if (dataRows.length > 0) {
    rawData.rows = dataRows;
  }

  const rawOutput =
    textOutput ||
    (dataRows.length > 0 ? JSON.stringify(dataRows, null, 2) : "");

  return {
    status,
    request_id:
      typeof payload.request_id === "string" && payload.request_id
        ? payload.request_id
        : `DBA-${Date.now()}`,
    action,
    db_status:
      payload.db_status === "healthy" ||
      payload.db_status === "warning" ||
      payload.db_status === "critical" ||
      payload.db_status === "unknown"
        ? payload.db_status
        : "unknown",
    ai_summary:
      typeof payload.ai_summary === "string" ? payload.ai_summary : "Execution completed.",
    findings: Array.isArray(payload.findings)
      ? (payload.findings as DbaResponse["findings"])
      : [],
    recommendations: Array.isArray(payload.recommendations)
      ? (payload.recommendations as DbaResponse["recommendations"])
      : [],
    raw_data: rawData,
    raw_output: rawOutput,
    approval:
      payload.approval && typeof payload.approval === "object"
        ? (payload.approval as DbaResponse["approval"])
        : undefined
  };
}
