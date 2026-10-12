// Queue state built only from engine events, so it can't drift from the engine.

import type { EngineEvent, JobStatus, Segment } from "../engine/protocol";

export type Job = {
  id: string;
  path: string;
  status: JobStatus;
  fraction: number;
  done: number; // seconds of audio processed
  total: number;
  segments: Segment[];
  error?: string;
  srtPath?: string | null;
  edited: boolean; // text changed since the SRT was last written
};

export type JobsState = { order: string[]; byId: Record<string, Job> };

export const emptyJobs: JobsState = { order: [], byId: {} };

const ACTIVE: JobStatus[] = ["queued", "running"];

function update(state: JobsState, id: string, patch: (job: Job) => Partial<Job>): JobsState {
  const job = state.byId[id];
  if (!job) return state;
  return { ...state, byId: { ...state.byId, [id]: { ...job, ...patch(job) } } };
}

export function applyEvent(state: JobsState, event: EngineEvent): JobsState {
  switch (event.name) {
    case "job.status": {
      const { job_id, path, status, error } = event.data;
      if (!state.byId[job_id]) {
        // The engine announces "queued" before transcribe.start returns, so status creates jobs.
        const job: Job = {
          id: job_id, path, status, fraction: 0, done: 0, total: 0, segments: [], error, edited: false,
        };
        return { order: [...state.order, job_id], byId: { ...state.byId, [job_id]: job } };
      }
      return update(state, job_id, () => ({ status, error }));
    }
    case "job.progress": {
      const { job_id, done, total, fraction } = event.data;
      return update(state, job_id, () => ({ done, total, fraction }));
    }
    case "job.segment":
      return update(state, event.data.job_id, (job) => ({
        segments: [...job.segments, event.data.segment],
      }));
    case "job.reset":
      return update(state, event.data.job_id, () => ({ segments: [], fraction: 0, done: 0 }));
    case "job.done":
      return update(state, event.data.job_id, () => ({
        segments: event.data.transcript.segments,
        srtPath: event.data.srt_path,
        fraction: 1,
      }));
    default:
      return state;
  }
}

/** The engine restarted: its queue is gone, so unfinished jobs failed. */
export function engineLost(state: JobsState, reason: string): JobsState {
  let next = state;
  for (const id of state.order) {
    if (ACTIVE.includes(state.byId[id].status)) {
      next = update(next, id, () => ({ status: "error", error: reason }));
    }
  }
  return next;
}

export function editSegment(state: JobsState, id: string, index: number, text: string): JobsState {
  const seg = state.byId[id]?.segments[index];
  if (!seg || seg.text === text) return state;
  return update(state, id, (job) => {
    const segments = job.segments.slice();
    segments[index] = { ...segments[index], text };
    return { segments, edited: true };
  });
}

export function markSaved(state: JobsState, id: string, srtPath: string): JobsState {
  return update(state, id, () => ({ edited: false, srtPath }));
}

export function removeJob(state: JobsState, id: string): JobsState {
  if (!state.byId[id]) return state;
  const byId = { ...state.byId };
  delete byId[id];
  return { order: state.order.filter((x) => x !== id), byId };
}

export function isActive(job: Job): boolean {
  return ACTIVE.includes(job.status);
}

export const MEDIA_EXTENSIONS = [
  "mp3", "wav", "m4a", "flac", "ogg", "opus", "aac", "wma",
  "mp4", "mkv", "mov", "avi", "webm",
];

export function isMedia(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_EXTENSIONS.includes(ext);
}
