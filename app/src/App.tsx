import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  Button,
  FluentProvider,
  makeStyles,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Subtitle2,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import { AddRegular, ClosedCaptionRegular, DismissRegular, SettingsRegular } from "@fluentui/react-icons";
import { engine, errorMessage } from "./engine/client";
import type { EngineEvent } from "./engine/protocol";
import {
  applyEvent,
  editSegment,
  emptyJobs,
  engineLost,
  isActive,
  isMedia,
  markSaved,
  removeJob,
  type JobsState,
} from "./state/jobs";
import { loadSettings, saveSettings, srtPathFor, type Settings } from "./settings";
import { onFileDrop, pickFolder, pickMediaFiles, revealInFolder } from "./platform";
import { useEngine } from "./useEngine";
import { darkTheme, lightTheme } from "./theme";
import { QueuePane } from "./components/QueuePane";
import { TranscriptPane } from "./components/TranscriptPane";
import { ModelSetup } from "./components/ModelSetup";
import { SettingsDrawer } from "./components/SettingsDrawer";

type Action =
  | { type: "event"; event: EngineEvent }
  | { type: "lost" }
  | { type: "edit"; id: string; index: number; text: string }
  | { type: "saved"; id: string; path: string }
  | { type: "remove"; ids: string[] };

function reducer(state: JobsState, a: Action): JobsState {
  switch (a.type) {
    case "event":
      return applyEvent(state, a.event);
    case "lost":
      return engineLost(state, "Движок перезапустился во время распознавания. Добавьте файл ещё раз.");
    case "edit":
      return editSegment(state, a.id, a.index, a.text);
    case "saved":
      return markSaved(state, a.id, a.path);
    case "remove":
      return a.ids.reduce(removeJob, state);
  }
}

const useStyles = makeStyles({
  app: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    position: "relative",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
    padding: `0 ${tokens.spacingHorizontalL}`,
    height: "52px",
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brand: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS, flex: 1 },
  logo: { fontSize: "22px", color: tokens.colorBrandForeground1 },
  banners: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalXS, padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL} 0` },
  reason: { whiteSpace: "pre-wrap", fontFamily: "inherit" },
  main: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr" },
  center: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  drop: {
    position: "absolute",
    inset: tokens.spacingHorizontalM,
    zIndex: 10, // above panes, below Fluent portals
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `2px dashed ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackgroundAlpha2,
    backdropFilter: "blur(2px)",
    pointerEvents: "none",
  },
});

function useDarkMode(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export function App() {
  const dark = useDarkMode();
  return (
    <FluentProvider theme={dark ? darkTheme : lightTheme}>
      <Shell />
    </FluentProvider>
  );
}

function Shell() {
  const s = useStyles();
  const [jobs, dispatch] = useReducer(reducer, emptyJobs);
  const onEvent = useCallback((event: EngineEvent) => dispatch({ type: "event", event }), []);
  const onLost = useCallback(() => dispatch({ type: "lost" }), []);
  const eng = useEngine(onEvent, onLost);

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const updateSettings = (patch: Partial<Settings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });

  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Model to use: the saved choice if downloaded, else the recommended one, else any downloaded one.
  const model = useMemo(() => {
    const downloaded = (eng.models ?? []).filter((m) => m.downloaded).map((m) => m.name);
    if (downloaded.includes(settings.model)) return settings.model;
    if (eng.system && downloaded.includes(eng.system.recommended_model)) return eng.system.recommended_model;
    return downloaded[0] ?? null;
  }, [eng.models, eng.system, settings.model]);

  const cudaMissing = eng.system?.cuda_runtime === "missing";
  const ready = eng.status.state === "running" && !!model && !cudaMissing;

  const addFiles = useCallback(
    async (paths: string[]) => {
      if (!model) return;
      const media = paths.filter(isMedia);
      if (media.length < paths.length) {
        setNotice("Некоторые файлы пропущены: это не аудио и не видео.");
      }
      for (const path of media) {
        try {
          const { job_id } = await engine.transcribe(path, srtPathFor(path, settings.outputDir), {
            model,
            initial_prompt: settings.prompt.trim() || null,
          });
          setSelected((cur) => cur ?? job_id);
        } catch (e) {
          setNotice(`${path}: ${errorMessage(e)}`);
        }
      }
    },
    [model, settings.outputDir, settings.prompt],
  );

  useEffect(
    () => onFileDrop((d) => setDragging(d === "over" && ready), (paths) => ready && addFiles(paths)),
    [addFiles, ready],
  );

  // Keep a valid selection: follow the running job when nothing is picked.
  useEffect(() => {
    if (selected && jobs.byId[selected]) return;
    const running = jobs.order.find((id) => jobs.byId[id].status === "running");
    setSelected(running ?? jobs.order[0] ?? null);
  }, [jobs, selected]);

  const job = selected ? jobs.byId[selected] : undefined;

  const save = async () => {
    if (!job) return;
    const path = job.srtPath ?? srtPathFor(job.path, settings.outputDir);
    setSaving(true);
    try {
      await engine.exportSrt({ language: "ru", duration: job.total, segments: job.segments }, path);
      dispatch({ type: "saved", id: job.id, path });
    } catch (e) {
      setNotice(`Не удалось сохранить SRT: ${errorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const chooseFolder = async () => {
    const dir = await pickFolder();
    if (dir) updateSettings({ outputDir: dir });
  };

  const needsModel = eng.status.state === "running" && eng.models !== null && !model;
  const needsSetup = needsModel || (eng.status.state === "running" && cudaMissing);
  const booting = eng.status.state === "starting" || (eng.status.state === "running" && eng.models === null && !eng.loadError);

  return (
    <div className={s.app}>
      <header className={s.bar}>
        <div className={s.brand}>
          <ClosedCaptionRegular className={s.logo} />
          <Subtitle2 as="h1">Transcriber</Subtitle2>
        </div>
        {!needsSetup && (
          <Button appearance="primary" icon={<AddRegular />} disabled={!ready} onClick={async () => addFiles(await pickMediaFiles())}>
            Добавить файлы
          </Button>
        )}
        <Tooltip content="Настройки" relationship="label">
          <Button appearance="subtle" icon={<SettingsRegular />} onClick={() => setSettingsOpen(true)} />
        </Tooltip>
      </header>

      <div className={s.banners}>
        {eng.status.state === "failed" && (
          <MessageBar intent="error" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>Движок распознавания не запускается</MessageBarTitle>
              <pre className={s.reason}>{eng.status.reason}</pre>
            </MessageBarBody>
            <MessageBarActions>
              <Button onClick={eng.restart}>Перезапустить</Button>
            </MessageBarActions>
          </MessageBar>
        )}
        {eng.status.state === "restarting" && (
          <MessageBar intent="warning">
            <MessageBarBody>Движок остановился, перезапускаем его.</MessageBarBody>
          </MessageBar>
        )}
        {eng.loadError && (
          <MessageBar intent="error">
            <MessageBarBody>Не удалось получить данные от движка: {eng.loadError}</MessageBarBody>
          </MessageBar>
        )}
        {eng.system?.device === "cpu" && (
          <MessageBar intent="warning">
            <MessageBarBody>
              Видеокарта NVIDIA не найдена. Распознавание пойдёт на процессоре и будет в десятки раз медленнее.
            </MessageBarBody>
          </MessageBar>
        )}
        {notice && (
          <MessageBar intent="error">
            <MessageBarBody>{notice}</MessageBarBody>
            <MessageBarActions
              containerAction={<Button appearance="transparent" aria-label="Закрыть" icon={<DismissRegular />} onClick={() => setNotice(null)} />}
            />
          </MessageBar>
        )}
      </div>

      {booting ? (
        <div className={s.center}>
          <Spinner label="Запускаем движок распознавания" />
        </div>
      ) : needsSetup ? (
        <ModelSetup
          models={eng.models!}
          needModel={needsModel}
          cudaMissing={cudaMissing}
          cudaSize={eng.system?.cuda_download_size ?? 0}
          initial={eng.system?.recommended_model ?? "large-v3"}
          download={eng.download}
          onStart={eng.startSetup}
        />
      ) : (
        <main className={s.main}>
          <QueuePane
            jobs={jobs}
            selected={selected}
            canAdd={ready}
            onSelect={setSelected}
            onCancel={(id) => engine.cancel(id).catch((e) => setNotice(errorMessage(e)))}
            onRemove={(id) => dispatch({ type: "remove", ids: [id] })}
            onClearFinished={() => dispatch({ type: "remove", ids: jobs.order.filter((id) => !isActive(jobs.byId[id])) })}
            onAdd={async () => addFiles(await pickMediaFiles())}
          />
          <TranscriptPane
            job={job}
            saving={saving}
            onEdit={(index, text) => job && dispatch({ type: "edit", id: job.id, index, text })}
            onSave={save}
            onReveal={() => job?.srtPath && revealInFolder(job.srtPath).catch((e) => setNotice(errorMessage(e)))}
          />
        </main>
      )}

      {dragging && (
        <div className={s.drop} aria-hidden>
          <Subtitle2>Отпустите, чтобы добавить в очередь</Subtitle2>
        </div>
      )}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        model={model ?? ""}
        models={eng.models ?? []}
        system={eng.system}
        download={eng.download}
        onDownload={eng.downloadModel}
        onPickFolder={chooseFolder}
      />
    </div>
  );
}
