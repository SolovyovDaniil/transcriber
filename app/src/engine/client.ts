import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EngineEvent,
  EngineStatus,
  ModelEntry,
  SystemInfo,
  TranscribeOptions,
} from "./protocol";

function request<T>(method: string, params: object = {}): Promise<T> {
  return invoke<T>("engine_request", { method, params });
}

export const engine = {
  systemInfo: () => request<SystemInfo>("system.info"),
  models: () => request<{ models: ModelEntry[] }>("models.list").then((r) => r.models),
  downloadModel: (model: string) => request<{ started: boolean }>("models.download", { model }),
  transcribe: (path: string, srtPath: string, options: TranscribeOptions) =>
    request<{ job_id: string }>("transcribe.start", { path, srt_path: srtPath, options }),
  cancel: (jobId: string) => request<{ cancelled: boolean }>("transcribe.cancel", { job_id: jobId }),
  status: () => invoke<EngineStatus>("engine_status"),
  restart: () => invoke<void>("engine_restart"),
};

export function onEngineEvent(cb: (e: EngineEvent) => void): Promise<UnlistenFn> {
  return listen<EngineEvent>("engine://event", (e) => cb(e.payload));
}

export function onEngineStatus(cb: (s: EngineStatus) => void): Promise<UnlistenFn> {
  return listen<EngineStatus>("engine://status", (e) => cb(e.payload));
}
