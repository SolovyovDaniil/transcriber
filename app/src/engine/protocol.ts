// Types for the engine's JSON Lines protocol (docs/TZ.md, 6.1).

export type Word = { start: number; end: number; word: string; probability: number };
export type Segment = { start: number; end: number; text: string; words: Word[] };
export type Transcript = { language: string; duration: number; segments: Segment[] };

export type Gpu = { name: string; vram_total_mb: number; vram_free_mb: number; driver: string };
export type SystemInfo = {
  version: string;
  device: "cuda" | "cpu";
  gpus: Gpu[];
  recommended_model: string;
  compute_types: string[];
  loaded: [string, string] | null;
};

export type ModelEntry = { name: string; size_mb: number; downloaded: boolean; recommended: boolean };

export type TranscribeOptions = {
  model?: string;
  initial_prompt?: string | null;
  vad_filter?: boolean;
  beam_size?: number;
};

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type EngineEvent =
  | { name: "job.status"; data: { job_id: string; path: string; status: JobStatus; error?: string } }
  | { name: "job.progress"; data: { job_id: string; done: number; total: number; fraction: number } }
  | { name: "job.segment"; data: { job_id: string; segment: Segment } }
  | { name: "job.reset"; data: { job_id: string; compute_type: string } }
  | { name: "job.done"; data: { job_id: string; transcript: Transcript; srt_path: string | null } }
  | { name: "model.progress"; data: { model: string; downloaded: number; total: number } }
  | { name: "model.done"; data: { model: string } }
  | { name: "model.error"; data: { model: string; error: string } };

export type EngineStatus =
  | { state: "starting" }
  | { state: "running" }
  | { state: "restarting"; reason: string }
  | { state: "failed"; reason: string }
  | { state: "stopped" };

export type EngineError = { code: string; message: string };
