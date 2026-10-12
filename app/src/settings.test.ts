import { describe, expect, it } from "vitest";
import { defaultSettings, loadSettings, saveSettings, srtPathFor } from "./settings";

describe("srtPathFor", () => {
  it.each([
    ["C:\\rec\\talk.mp4", null, "C:\\rec\\talk.srt"],
    ["C:\\rec.v2\\talk", null, "C:\\rec.v2\\talk.srt"],
    ["/home/u/лекция.part1.mkv", null, "/home/u/лекция.part1.srt"],
    ["C:\\rec\\.hidden", null, "C:\\rec\\.hidden.srt"],
    ["C:\\rec\\talk.mp4", "D:\\Субтитры", "D:\\Субтитры\\talk.srt"],
    ["C:\\rec\\talk.mp4", "D:\\Субтитры\\", "D:\\Субтитры\\talk.srt"],
    ["/home/u/a.mp3", "/out", "/out/a.srt"],
  ])("srtPathFor(%s, %s)", (path, dir, expected) => {
    expect(srtPathFor(path, dir)).toBe(expected);
  });
});

describe("settings storage", () => {
  it("round-trips and falls back to defaults on garbage", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadSettings(storage)).toEqual(defaultSettings);
    saveSettings({ model: "large-v3", outputDir: "D:\\out", prompt: "Кубернетес" }, storage);
    expect(loadSettings(storage)).toEqual({ model: "large-v3", outputDir: "D:\\out", prompt: "Кубернетес" });
    mem.set("transcriber.settings.v1", "{oops");
    expect(loadSettings(storage)).toEqual(defaultSettings);
  });
});
