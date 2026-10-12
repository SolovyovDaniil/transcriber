import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EngineEvent,
  EngineStatus,
  ModelEntry,
  SystemInfo,
  TranscribeOptions,
  Transcript,
} from "./protocol";
import { createMockEngine } from "./mock";

export type EngineApi = {
  systemInfo(): Promise<SystemInfo>;
  models(): Promise<ModelEntry[]>;
  downloadModel(model: string): Promise<unknown>;
  transcribe(path: string, srtPath: string, options: TranscribeOptions): Promise<{ job_id: string }>;
  cancel(jobId: string): Promise<{ cancelled: boolean }>;
  exportSrt(transcript: Transcript, path: string): Promise<{ path: string }>;
  status(): Promise<EngineStatus>;
  restart(): Promise<void>;
  onEvent(cb: (e: EngineEvent) => void): Promise<UnlistenFn>;
  onStatus(cb: (s: EngineStatus) => void): Promise<UnlistenFn>;
};

function request<T>(method: string, params: object = {}): Promise<T> {
  return invoke<T>("engine_request", { method, params });
}

const tauriEngine: EngineApi = {
  systemInfo: () => request("system.info"),
  models: () => request<{ models: ModelEntry[] }>("models.list").then((r) => r.models),
  downloadModel: (model) => request("models.download", { model }),
  transcribe: (path, srtPath, options) => request("transcribe.start", { path, srt_path: srtPath, options }),
  cancel: (jobId) => request("transcribe.cancel", { job_id: jobId }),
  exportSrt: (transcript, path) => request("export", { transcript, format: "srt", path }),
  status: () => invoke("engine_status"),
  restart: () => invoke("engine_restart"),
  onEvent: (cb) => listen<EngineEvent>("engine://event", (e) => cb(e.payload)),
  onStatus: (cb) => listen<EngineStatus>("engine://status", (e) => cb(e.payload)),
};

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Outside Tauri (plain browser during development) a simulated engine drives the UI.
// import.meta.env.DEV is false in production builds, so the mock is tree-shaken away.
export const engine: EngineApi =
  !isTauri && import.meta.env.DEV ? createMockEngine(new URLSearchParams(location.search)) : tauriEngine;

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
