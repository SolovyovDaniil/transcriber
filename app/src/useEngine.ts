// Engine connection state: status, system info, models and model downloads.

import { useCallback, useEffect, useState } from "react";
import { engine, errorMessage } from "./engine/client";
import type { EngineEvent, EngineStatus, ModelEntry, SystemInfo } from "./engine/protocol";

export type Download = { model: string; downloaded: number; total: number; error?: string };

export function useEngine(onEvent: (e: EngineEvent) => void, onLost: () => void) {
  const [status, setStatus] = useState<EngineStatus>({ state: "starting" });
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [download, setDownload] = useState<Download | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [info, list] = await Promise.all([engine.systemInfo(), engine.models()]);
      setSystem(info);
      setModels(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const subs = [
      engine.onEvent((e) => {
        onEvent(e);
        if (e.name === "model.progress") {
          setDownload({ model: e.data.model, downloaded: e.data.downloaded, total: e.data.total });
        } else if (e.name === "model.done") {
          setDownload(null);
          refresh();
        } else if (e.name === "model.error") {
          setDownload((d) => ({ model: e.data.model, downloaded: d?.downloaded ?? 0, total: d?.total ?? 0, error: e.data.error }));
        }
      }),
      engine.onStatus((s) => {
        setStatus(s);
        if (s.state === "running") refresh();
        if (s.state === "restarting" || s.state === "failed") {
          onLost();
          setDownload(null);
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
  }, [refresh]);

  const startDownload = useCallback(async (model: string) => {
    setDownload({ model, downloaded: 0, total: 0 });
    try {
      await engine.downloadModel(model);
    } catch (e) {
      setDownload({ model, downloaded: 0, total: 0, error: errorMessage(e) });
    }
  }, []);

  return { status, system, models, download, loadError, startDownload, restart: () => engine.restart() };
}
