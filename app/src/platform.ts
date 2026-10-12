// OS integration (file dialogs, drag and drop, Explorer). Falls back to stubs in a plain browser.

import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "./engine/client";
import { MEDIA_EXTENSIONS } from "./state/jobs";

export async function pickMediaFiles(): Promise<string[]> {
  if (!isTauri) return ["C:\\Записи\\Интервью с Ольгой Сергеевной.m4a"];
  const picked = await open({
    multiple: true,
    filters: [{ name: "Аудио и видео", extensions: MEDIA_EXTENSIONS }],
  });
  return picked ? (Array.isArray(picked) ? picked : [picked]) : [];
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return "D:\\Субтитры";
  const picked = await open({ directory: true });
  return typeof picked === "string" ? picked : null;
}

export async function revealInFolder(path: string): Promise<void> {
  if (isTauri) await revealItemInDir(path);
}

export type DragState = "idle" | "over";

export function onFileDrop(onDrag: (s: DragState) => void, onDrop: (paths: string[]) => void): () => void {
  if (!isTauri) return () => {};
  const unlisten = getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") onDrag("over");
    else if (p.type === "leave") onDrag("idle");
    else if (p.type === "drop") {
      onDrag("idle");
      onDrop(p.paths);
    }
  });
  return () => {
    unlisten.then((fn) => fn());
  };
}
