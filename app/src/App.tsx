// Working screen for stage 3: proves the engine bridge end to end.
// Layout and visuals are placeholders until the taste design pass (stage 4).

import { useCallback, useEffect, useReducer, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { engine, onEngineEvent, onEngineStatus } from "./engine/client";
import type { EngineEvent, EngineStatus, ModelEntry, SystemInfo } from "./engine/protocol";
import {
  applyEvent,
  emptyJobs,
  engineLost,
  isMedia,
  MEDIA_EXTENSIONS,
  srtPathFor,
  type Job,
  type JobsState,
} from "./state/jobs";
import { timestamp } from "./format";

type Action = { type: "event"; event: EngineEvent } | { type: "lost"; reason: string };

function reducer(state: JobsState, action: Action): JobsState {
  return action.type === "event" ? applyEvent(state, action.event) : engineLost(state, action.reason);
}

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "В очереди",
  running: "Распознаётся",
  done: "Готово",
  error: "Ошибка",
  cancelled: "Отменено",
};

const MODEL_LABEL: Record<string, string> = {
  "large-v3": "Максимальное качество (large-v3)",
  "large-v3-turbo": "Быстро (large-v3-turbo)",
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function App() {
  const [jobs, dispatch] = useReducer(reducer, emptyJobs);
  const [status, setStatus] = useState<EngineStatus>({ state: "starting" });
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [model, setModel] = useState(""); // "" until the engine recommends one
  const [download, setDownload] = useState<{ model: string; fraction: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [info, list] = await Promise.all([engine.systemInfo(), engine.models()]);
      setSystem(info);
      setModels(list);
      setModel((current) => (list.some((m) => m.name === current) ? current : info.recommended_model));
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  }, []);

  useEffect(() => {
    const unlisten = [
      onEngineEvent((event) => {
        dispatch({ type: "event", event });
        if (event.name === "model.progress") {
          setDownload({ model: event.data.model, fraction: event.data.downloaded / event.data.total });
        } else if (event.name === "model.done") {
          setDownload(null);
          refresh();
        } else if (event.name === "model.error") {
          setDownload(null);
          setError(`Не удалось скачать модель: ${event.data.error}`);
        }
      }),
      onEngineStatus((s) => {
        setStatus(s);
        if (s.state === "running") refresh();
        if (s.state === "restarting" || s.state === "failed") {
          dispatch({ type: "lost", reason: "Движок перезапущен во время работы" });
        }
      }),
    ];
    engine.status().then((s) => {
      setStatus(s);
      if (s.state === "running") refresh();
    });
    return () => unlisten.forEach((p) => p.then((fn) => fn()));
  }, [refresh]);

  const current = models.find((m) => m.name === model);

  const addFiles = useCallback(
    async (paths: string[]) => {
      setError(null);
      for (const path of paths.filter(isMedia)) {
        try {
          const { job_id } = await engine.transcribe(path, srtPathFor(path), { model });
          setSelected((s) => s ?? job_id);
        } catch (e) {
          setError(`${fileName(path)}: ${(e as { message?: string }).message ?? e}`);
        }
      }
    },
    [model],
  );

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") addFiles(e.payload.paths);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addFiles]);

  const pickFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Аудио и видео", extensions: MEDIA_EXTENSIONS }],
    });
    if (picked) addFiles(Array.isArray(picked) ? picked : [picked]);
  };

  const job = selected ? jobs.byId[selected] : undefined;
  const gpu = system?.gpus[0];

  return (
    <div className="app">
      <header className="bar">
        <strong>Transcriber</strong>
        <span className={`engine engine-${status.state}`}>
          {status.state === "running" ? "Движок готов" : status.state === "starting" ? "Запуск…" : status.state === "restarting" ? "Перезапуск…" : status.state === "failed" ? "Движок не запустился" : "Остановлен"}
        </span>
        <span className="muted">
          {system ? (gpu ? `${gpu.name}, ${(gpu.vram_total_mb / 1024).toFixed(1)} ГБ` : "Без видеокарты NVIDIA — будет медленно") : ""}
        </span>
        {status.state === "failed" && <button onClick={() => engine.restart()}>Перезапустить</button>}
      </header>
      {status.state === "failed" && <pre className="error">{status.reason}</pre>}
      {error && <div className="error">{error}</div>}

      <section className="controls">
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {models
            .filter((m) => m.name in MODEL_LABEL)
            .map((m) => (
              <option key={m.name} value={m.name}>
                {MODEL_LABEL[m.name]}
                {m.downloaded ? "" : ` — не скачана (${(m.size_mb / 1024).toFixed(1)} ГБ)`}
              </option>
            ))}
        </select>
        {current && !current.downloaded &&
          (download?.model === model ? (
            <progress value={download.fraction} />
          ) : (
            <button onClick={() => engine.downloadModel(model).catch((e) => setError(e.message))}>
              Скачать модель
            </button>
          ))}
        <button className="primary" disabled={status.state !== "running" || !current?.downloaded} onClick={pickFiles}>
          Добавить файлы
        </button>
        <span className="muted">или перетащите их в окно — SRT сохранится рядом с файлом</span>
      </section>

      <main className="split">
        <ul className="queue">
          {jobs.order.length === 0 && <li className="muted">Очередь пуста</li>}
          {jobs.order.map((id) => {
            const j = jobs.byId[id];
            return (
              <li key={id} className={id === selected ? "active" : ""} onClick={() => setSelected(id)}>
                <div className="row">
                  <span className="name">{fileName(j.path)}</span>
                  <span className={`st st-${j.status}`}>{STATUS_LABEL[j.status]}</span>
                </div>
                {j.status === "running" && <progress value={j.fraction} />}
                {j.error && <div className="error small">{j.error}</div>}
                {(j.status === "queued" || j.status === "running") && (
                  <button className="small" onClick={(e) => { e.stopPropagation(); engine.cancel(id); }}>
                    Отменить
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="transcript">
          {job ? (
            <>
              <div className="muted">
                {job.srtPath ? `Сохранено: ${job.srtPath}` : job.total ? `${timestamp(job.done)} из ${timestamp(job.total)}` : ""}
              </div>
              {job.segments.map((s, i) => (
                <p key={i}>
                  <span className="ts">{timestamp(s.start)}</span> {s.text.trim()}
                </p>
              ))}
            </>
          ) : (
            <div className="muted">Выберите файл в очереди</div>
          )}
        </div>
      </main>
    </div>
  );
}
