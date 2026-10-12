import { describe, expect, it } from "vitest";
import type { EngineEvent, Segment } from "../engine/protocol";
import { applyEvent, emptyJobs, engineLost, isMedia, srtPathFor } from "./jobs";

const seg = (start: number, text: string): Segment => ({ start, end: start + 1, text, words: [] });

const run = (...events: EngineEvent[]) => events.reduce(applyEvent, emptyJobs);

const queued = (id = "j1", path = "C:\\rec\\a.mp3"): EngineEvent => ({
  name: "job.status",
  data: { job_id: id, path, status: "queued" },
});

describe("applyEvent", () => {
  it("creates a job from its first status event", () => {
    const s = run(queued());
    expect(s.order).toEqual(["j1"]);
    expect(s.byId.j1).toMatchObject({ path: "C:\\rec\\a.mp3", status: "queued", fraction: 0 });
  });

  it("tracks progress, segments and completion", () => {
    const s = run(
      queued(),
      { name: "job.status", data: { job_id: "j1", path: "a", status: "running" } },
      { name: "job.segment", data: { job_id: "j1", segment: seg(0, "Раз") } },
      { name: "job.progress", data: { job_id: "j1", done: 1, total: 4, fraction: 0.25 } },
      {
        name: "job.done",
        data: {
          job_id: "j1",
          transcript: { language: "ru", duration: 4, segments: [seg(0, "Раз"), seg(1, "два")] },
          srt_path: "C:\\rec\\a.srt",
        },
      },
      { name: "job.status", data: { job_id: "j1", path: "a", status: "done" } },
    );
    expect(s.byId.j1).toMatchObject({ status: "done", fraction: 1, srtPath: "C:\\rec\\a.srt", total: 4 });
    expect(s.byId.j1.segments.map((x) => x.text)).toEqual(["Раз", "два"]);
  });

  it("clears partial output when the engine restarts a job with lighter precision", () => {
    const s = run(
      queued(),
      { name: "job.segment", data: { job_id: "j1", segment: seg(0, "x") } },
      { name: "job.reset", data: { job_id: "j1", compute_type: "int8_float16" } },
    );
    expect(s.byId.j1.segments).toEqual([]);
  });

  it("keeps the error message", () => {
    const s = run(queued(), {
      name: "job.status",
      data: { job_id: "j1", path: "a", status: "error", error: "Invalid data" },
    });
    expect(s.byId.j1).toMatchObject({ status: "error", error: "Invalid data" });
  });

  it("ignores events for unknown jobs and model events", () => {
    const s = run(
      { name: "job.segment", data: { job_id: "nope", segment: seg(0, "x") } },
      { name: "model.done", data: { model: "large-v3" } },
    );
    expect(s).toEqual(emptyJobs);
  });
});

describe("engineLost", () => {
  it("fails only unfinished jobs", () => {
    let s = run(queued("a"), queued("b"), queued("c"));
    s = applyEvent(s, { name: "job.status", data: { job_id: "a", path: "a", status: "done" } });
    s = applyEvent(s, { name: "job.status", data: { job_id: "b", path: "b", status: "running" } });
    s = engineLost(s, "Движок перезапущен");
    expect(s.order.map((id) => s.byId[id].status)).toEqual(["done", "error", "error"]);
    expect(s.byId.b.error).toBe("Движок перезапущен");
  });
});

describe("paths", () => {
  it.each([
    ["C:\\rec\\talk.mp4", "C:\\rec\\talk.srt"],
    ["C:\\rec.v2\\talk", "C:\\rec.v2\\talk.srt"],
    ["/home/u/лекция.part1.mkv", "/home/u/лекция.part1.srt"],
    ["C:\\rec\\.hidden", "C:\\rec\\.hidden.srt"],
  ])("srtPathFor(%s)", (input, expected) => {
    expect(srtPathFor(input)).toBe(expected);
  });

  it("recognises media files", () => {
    expect(isMedia("C:\\a\\B.MP4")).toBe(true);
    expect(isMedia("C:\\a\\notes.txt")).toBe(false);
  });
});
