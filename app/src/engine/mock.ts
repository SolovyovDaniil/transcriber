// Simulated engine for working on the UI in a browser (npm run dev, no Tauri).
// ?scenario=first-run | download-error | working | failed | cpu   (default: working)

import type { EngineApi } from "./client";
import type { EngineEvent, EngineStatus, ModelEntry, Segment } from "./protocol";

const LINES = [
  "Добрый день. Сегодня мы поговорим о том, как устроена городская система водоснабжения.",
  "Начнём с истории: первый водопровод в Москве появился в конце восемнадцатого века.",
  "Тогда воду брали из Мытищинских источников и подавали самотёком.",
  "Сейчас схема другая. Основные станции берут воду из Москвы-реки и Волги.",
  "На каждой станции вода проходит несколько ступеней очистки.",
  "Первая ступень механическая: решётки и отстойники убирают крупные примеси.",
  "Дальше идёт коагуляция. В воду добавляют реагенты, и мелкие частицы слипаются в хлопья.",
  "После этого воду фильтруют через песок и уголь, а затем обеззараживают.",
  "Отдельный вопрос, о котором часто спрашивают, это жёсткость воды.",
  "Она зависит от источника и от сезона, весной обычно ниже.",
  "Если у вас дома накипь в чайнике, это не значит, что вода плохая.",
  "Давайте посмотрим на цифры, которые публикует сама водоканальная компания.",
];

type Listener<T> = (x: T) => void;

export function createMockEngine(params: URLSearchParams): EngineApi {
  const scenario = params.get("scenario") ?? "working";
  const events = new Set<Listener<EngineEvent>>();
  const statuses = new Set<Listener<EngineStatus>>();
  const emit = (e: EngineEvent) => events.forEach((cb) => cb(e));
  let status: EngineStatus =
    scenario === "failed"
      ? { state: "failed", reason: "Движок завершился (код 1). OSError: [WinError 126] Не найден указанный модуль: cudnn_ops64_9.dll" }
      : { state: "running" };
  const models: ModelEntry[] = [
    { name: "large-v3", size_mb: 3100, downloaded: !scenario.includes("-"), recommended: true },
    { name: "large-v3-turbo", size_mb: 1600, downloaded: false, recommended: false },
  ];
  let cudaReady = !scenario.includes("-");
  const queue: { id: string; path: string; srt: string }[] = [];
  let running = false;
  let seq = 0;

  const runNext = () => {
    if (running || !queue.length) return;
    running = true;
    const job = queue.shift()!;
    emit({ name: "job.status", data: { job_id: job.id, path: job.path, status: "running" } });
    const total = 2827;
    const segments: Segment[] = [];
    let i = 0;
    const tick = setInterval(() => {
      if (cancelled.has(job.id)) {
        clearInterval(tick);
        emit({ name: "job.status", data: { job_id: job.id, path: job.path, status: "cancelled" } });
        running = false;
        return runNext();
      }
      if (job.path.includes("повреждён")) {
        clearInterval(tick);
        emit({ name: "job.status", data: { job_id: job.id, path: job.path, status: "error", error: "Не удалось прочитать файл: Invalid data found when processing input" } });
        running = false;
        return runNext();
      }
      const start = i * 7.4;
      const seg = { start, end: start + 6.9, text: " " + LINES[i % LINES.length], words: [] };
      segments.push(seg);
      emit({ name: "job.segment", data: { job_id: job.id, segment: seg } });
      emit({ name: "job.progress", data: { job_id: job.id, done: seg.end, total, fraction: seg.end / total } });
      i++;
      if (i >= LINES.length * 2) {
        clearInterval(tick);
        emit({ name: "job.done", data: { job_id: job.id, transcript: { language: "ru", duration: total, segments }, srt_path: job.srt } });
        emit({ name: "job.status", data: { job_id: job.id, path: job.path, status: "done" } });
        running = false;
        runNext();
      }
    }, scenario === "working" ? 900 : 300);
  };
  const cancelled = new Set<string>();

  const api: EngineApi = {
    async systemInfo() {
      const cpu = scenario === "cpu";
      return {
        version: "0.1.0",
        device: cpu ? "cpu" : "cuda",
        gpus: cpu ? [] : [{ name: "NVIDIA GeForce RTX 4060", vram_total_mb: 8188, vram_free_mb: 7302, driver: "566.36" }],
        recommended_model: cpu ? "large-v3-turbo" : "large-v3",
        compute_types: cpu ? ["int8"] : ["float16", "int8_float16", "int8"],
        loaded: null,
        cuda_runtime: cpu ? "not_needed" : cudaReady ? "ready" : "missing",
        cuda_download_size: 1296231748,
      };
    },
    async models() {
      return models.map((m) => ({ ...m }));
    },
    async downloadRuntime() {
      const total = 1296231748;
      let done = 0;
      const tick = setInterval(() => {
        done = Math.min(total, done + total / 15);
        emit({ name: "runtime.progress", data: { downloaded: done, total } });
        if (done >= total) {
          clearInterval(tick);
          cudaReady = true;
          emit({ name: "runtime.done", data: {} });
        }
      }, 200);
      return { started: true };
    },
    async downloadModel(name) {
      const m = models.find((x) => x.name === name)!;
      const total = m.size_mb * 1024 * 1024;
      let done = 0;
      const tick = setInterval(() => {
        done = Math.min(total, done + total / 25);
        emit({ name: "model.progress", data: { model: name, downloaded: done, total } });
        if (scenario === "download-error" && done > total / 3) {
          clearInterval(tick);
          emit({ name: "model.error", data: { model: name, error: "Нет соединения с huggingface.co" } });
        } else if (done >= total) {
          clearInterval(tick);
          m.downloaded = true;
          emit({ name: "model.done", data: { model: name } });
        }
      }, 200);
      return { started: true };
    },
    async transcribe(path, srt) {
      const id = `mock-${++seq}`;
      emit({ name: "job.status", data: { job_id: id, path, status: "queued" } });
      queue.push({ id, path, srt });
      setTimeout(runNext, 600);
      return { job_id: id };
    },
    async cancel(id) {
      cancelled.add(id);
      const i = queue.findIndex((j) => j.id === id);
      if (i >= 0) {
        const [job] = queue.splice(i, 1);
        emit({ name: "job.status", data: { job_id: id, path: job.path, status: "cancelled" } });
      }
      return { cancelled: true };
    },
    async exportSrt(_t, path) {
      return { path };
    },
    async status() {
      return status;
    },
    async restart() {
      status = { state: "running" };
      statuses.forEach((cb) => cb(status));
    },
    async onEvent(cb) {
      events.add(cb);
      return () => events.delete(cb);
    },
    async onStatus(cb) {
      statuses.add(cb);
      return () => statuses.delete(cb);
    },
  };

  if (scenario === "working") {
    // Seed a realistic queue once the UI has subscribed.
    setTimeout(() => {
      api.transcribe("C:\\Записи\\Лекция 3. Водоснабжение.mp4", "C:\\Записи\\Лекция 3. Водоснабжение.srt", {});
      api.transcribe("C:\\Записи\\Созвон с редакцией 12.09.m4a", "C:\\Записи\\Созвон с редакцией 12.09.srt", {});
      api.transcribe("C:\\Записи\\Интервью, повреждён.wav", "C:\\Записи\\Интервью, повреждён.srt", {});
    }, 300);
  }
  return api;
}
