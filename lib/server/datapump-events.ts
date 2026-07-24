import "server-only";

export interface DataPumpCallbackPayload {
  job_id: string;
  status: "success" | "error" | "running" | "completed";
  action: "expdp" | "impdp";
  db?: string;
  dump_file?: string;
  transfer_status?: string;
  message?: string;
}

type Listener = (payload: DataPumpCallbackPayload) => void;

const globalDataPumpState = globalThis as typeof globalThis & {
  __dataPumpListeners?: Map<string, Set<Listener>>;
};

const listeners = globalDataPumpState.__dataPumpListeners ?? new Map<string, Set<Listener>>();
globalDataPumpState.__dataPumpListeners = listeners;

export function subscribeDataPumpJob(jobId: string, fn: Listener) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId)!.add(fn);
  return () => {
    listeners.get(jobId)?.delete(fn);
    if (listeners.get(jobId)?.size === 0) listeners.delete(jobId);
  };
}

export function notifyDataPumpJob(payload: DataPumpCallbackPayload) {
  const jobListeners = listeners.get(payload.job_id);
  if (jobListeners) {
    for (const fn of jobListeners) {
      try {
        fn(payload);
      } catch {
        // ignore listener errors
      }
    }
  }

  const wildcard = listeners.get("*");
  if (wildcard) {
    for (const fn of wildcard) {
      try {
        fn(payload);
      } catch {
        // ignore listener errors
      }
    }
  }
}
