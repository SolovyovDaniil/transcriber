// User preferences, kept in the webview's localStorage (survives restarts in Tauri).

export type Settings = {
  model: string; // "" = use the engine's recommendation
  outputDir: string | null; // null = next to the source file
  prompt: string; // names and terms that Whisper should spell right
};

const KEY = "transcriber.settings.v1";
export const defaultSettings: Settings = { model: "", outputDir: null, prompt: "" };

export function loadSettings(storage: Pick<Storage, "getItem"> = localStorage): Settings {
  try {
    const raw = storage.getItem(KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(KEY, JSON.stringify(s));
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** C:\rec\talk.mp4 -> C:\rec\talk.srt, or <outputDir>\talk.srt */
export function srtPathFor(path: string, outputDir: string | null = null): string {
  const sep = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const dot = path.lastIndexOf(".");
  const stem = dot > sep + 1 ? path.slice(0, dot) : path;
  if (!outputDir) return stem + ".srt";
  const slash = outputDir.includes("\\") ? "\\" : "/";
  return outputDir.replace(/[\\/]+$/, "") + slash + baseName(stem) + ".srt";
}
