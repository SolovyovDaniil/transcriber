// Engine connection state: status, system info, models, and first-run downloads
// (CUDA libraries, then the model).

import { useCallback, useEffect, useRef, useState } from "react";
import { engine, errorMessage } from "./engine/client";
import type { EngineEvent, EngineStatus, ModelEntry, SystemInfo } from "./engine/protocol";

export type Download = {
  kind: "cuda" | "model";
  model?: string;
  downloaded: number;
  total: number;
  error?: string;
};

export function useEngine(onEvent: (e: EngineEvent) => void, onLost: () => void) {
  const [status, setStatus] = useState<EngineStatus>({ state: "starting" });
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [download, setDownload] = useState<Download | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nextModel = useRef<string | null>(null); // model to fetch once CUDA is in place

  const refresh = useCallback(async () => {
    try {
      const [info, list] = await Promise.all([engine.systemInfo(), engine.models()]);
      setSystem(info);
      setModels(list);
      setLoadError(null);
      return { info, list };
    } catch (e) {
      setLoadError(errorMessage(e));
      return null;
    }
  }, []);

  const downloadModel = useCallback(async (model: string) => {
    setDownload({ kind: "model", model, downloaded: 0, total: 0 });
    try {
      await engine.downloadModel(model);
    } catch (e) {
      setDownload({ kind: "model", model, downloaded: 0, total: 0, error: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    const subs = [
      engine.onEvent(async (e) => {
        onEvent(e);
        switch (e.name) {
          case "runtime.progress":
            setDownload({ kind: "cuda", downloaded: e.data.downloaded, total: e.data.total });
            break;
          case "runtime.error":
            nextModel.current = null;
            setDownload((d) => ({ kind: "cuda", downloaded: d?.downloaded ?? 0, total: d?.total ?? 0, error: e.data.error }));
            break;
          case "runtime.done": {
            setDownload(null);
            const fresh = await refresh();
            const model = nextModel.current;
            nextModel.current = null;
            if (model && fresh && !fresh.list.find((m) => m.name === model)?.downloaded) downloadModel(model);
            break;
          }
          case "model.progress":
            setDownload({ kind: "model", model: e.data.model, downloaded: e.data.downloaded, total: e.data.total });
            break;
          case "model.done":
            setDownload(null);
            refresh();
            break;
          case "model.error":
            setDownload((d) => ({ kind: "model", model: e.data.model, downloaded: d?.downloaded ?? 0, total: d?.total ?? 0, error: e.data.error }));
            break;
        }
      }),
      engine.onStatus((s) => {
        setStatus(s);
        if (s.state === "running") refresh();
        if (s.state === "restarting" || s.state === "failed") {
          onLost();
          setDownload(null);
          nextModel.current = null;
        }
      }),
    ];
    engine.status().then((s) => {
      setStatus(s);
      if (s.state === "running") refresh();
    });
    return () => subs.forEach((p) => p.then((off) => off()));
    // onEvent/onLost are stable dispatch wrappers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, downloadModel]);

  /** First-run setup: CUDA libraries if missing, then the model if given. */
  const startSetup = useCallback(
    async (model: string | null) => {
      if (system?.cuda_runtime === "missing") {
        nextModel.current = model;
        setDownload({ kind: "cuda", downloaded: 0, total: 0 });
        try {
          await engine.downloadRuntime();
        } catch (e) {
          nextModel.current = null;
          setDownload({ kind: "cuda", downloaded: 0, total: 0, error: errorMessage(e) });
        }
      } else if (model) {
        downloadModel(model);
      }
    },
    [system, downloadModel],
  );

  return {
    status,
    system,
    models,
    download,
    loadError,
    startSetup,
    downloadModel,
    restart: () => engine.restart(),
  };
}
