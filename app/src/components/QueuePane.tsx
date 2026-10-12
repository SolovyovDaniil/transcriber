import {
  Body1,
  Button,
  Caption1,
  makeStyles,
  mergeClasses,
  ProgressBar,
  Spinner,
  Subtitle2,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import {
  CheckmarkCircleFilled,
  ClockRegular,
  DeleteRegular,
  DismissCircleRegular,
  DismissRegular,
  DocumentArrowUpRegular,
  ErrorCircleFilled,
} from "@fluentui/react-icons";
import { timestamp } from "../format";
import { baseName } from "../settings";
import { isActive, type Job, type JobsState } from "../state/jobs";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    minHeight: "32px",
  },
  list: { listStyle: "none", margin: 0, padding: `0 ${tokens.spacingHorizontalS}`, overflowY: "auto", flex: 1 },
  item: {
    display: "grid",
    gridTemplateColumns: "20px 1fr auto",
    columnGap: tokens.spacingHorizontalM,
    alignItems: "start",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    outlineStyle: "none",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}` },
    ":hover .actions, :focus-within .actions": { opacity: 1 },
  },
  selected: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundSelected },
  },
  icon: { paddingTop: "2px", display: "flex" },
  text: { minWidth: 0, display: "flex", flexDirection: "column", rowGap: "2px" },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { color: tokens.colorNeutralForeground3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  error: { color: tokens.colorPaletteRedForeground1 },
  progress: { marginTop: tokens.spacingVerticalXS },
  actions: { opacity: 0, transitionProperty: "opacity", transitionDuration: tokens.durationFaster },
  done: { color: tokens.colorPaletteGreenForeground1 },
  failed: { color: tokens.colorPaletteRedForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  empty: {
    flex: 1,
    margin: tokens.spacingHorizontalL,
    marginTop: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    rowGap: tokens.spacingVerticalM,
    textAlign: "center",
    padding: tokens.spacingHorizontalXL,
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    color: tokens.colorNeutralForeground2,
  },
  emptyIcon: { fontSize: "40px", color: tokens.colorBrandForeground1 },
});

function StatusIcon({ job }: { job: Job }) {
  const s = useStyles();
  switch (job.status) {
    case "running":
      return <Spinner size="extra-tiny" aria-label="Распознаётся" />;
    case "done":
      return <CheckmarkCircleFilled fontSize={16} className={s.done} aria-label="Готово" />;
    case "error":
      return <ErrorCircleFilled fontSize={16} className={s.failed} aria-label="Ошибка" />;
    case "cancelled":
      return <DismissCircleRegular fontSize={16} className={s.muted} aria-label="Отменено" />;
    default:
      return <ClockRegular fontSize={16} className={s.muted} aria-label="В очереди" />;
  }
}

function metaText(job: Job): string {
  switch (job.status) {
    case "queued":
      return "В очереди";
    case "running":
      return job.total ? `${timestamp(job.done)} из ${timestamp(job.total)}` : "Загрузка модели";
    case "done":
      return job.edited ? `${timestamp(job.total)}, есть несохранённые правки` : `${timestamp(job.total)}, SRT сохранён`;
    case "cancelled":
      return "Отменено";
    case "error":
      return job.error ?? "Ошибка";
  }
}

type Props = {
  jobs: JobsState;
  selected: string | null;
  canAdd: boolean;
  onSelect(id: string): void;
  onCancel(id: string): void;
  onRemove(id: string): void;
  onClearFinished(): void;
  onAdd(): void;
};

export function QueuePane({ jobs, selected, canAdd, onSelect, onCancel, onRemove, onClearFinished, onAdd }: Props) {
  const s = useStyles();
  const list = jobs.order.map((id) => jobs.byId[id]);
  const finished = list.filter((j) => !isActive(j)).length;

  return (
    <aside className={s.root} aria-label="Очередь файлов">
      <div className={s.header}>
        <Subtitle2>Очередь</Subtitle2>
        {finished > 0 && (
          <Button appearance="subtle" size="small" onClick={onClearFinished}>
            Убрать завершённые
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <div className={s.empty}>
          <DocumentArrowUpRegular className={s.emptyIcon} />
          <Body1>Перетащите сюда аудио или видео</Body1>
          <Caption1>MP3, WAV, M4A, MP4, MKV и другие. SRT появится рядом с файлом.</Caption1>
          <Button onClick={onAdd} disabled={!canAdd}>
            Выбрать файлы
          </Button>
        </div>
      ) : (
        <ul className={s.list}>
          {list.map((job) => (
            <li
              key={job.id}
              tabIndex={0}
              aria-current={job.id === selected}
              className={mergeClasses(s.item, job.id === selected && s.selected)}
              onClick={() => onSelect(job.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(job.id)}
            >
              <span className={s.icon}>
                <StatusIcon job={job} />
              </span>
              <span className={s.text}>
                <Body1 className={s.name} title={job.path}>
                  {baseName(job.path)}
                </Body1>
                <Caption1 className={mergeClasses(s.meta, job.status === "error" && s.error)} title={job.error}>
                  {metaText(job)}
                </Caption1>
                {job.status === "running" && (
                  <ProgressBar className={s.progress} value={job.total ? job.fraction : undefined} thickness="medium" />
                )}
              </span>
              <span className={mergeClasses(s.actions, "actions")}>
                {isActive(job) ? (
                  <Tooltip content="Отменить" relationship="label">
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DismissRegular />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancel(job.id);
                      }}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip content="Убрать из списка" relationship="label">
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DeleteRegular />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(job.id);
                      }}
                    />
                  </Tooltip>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
