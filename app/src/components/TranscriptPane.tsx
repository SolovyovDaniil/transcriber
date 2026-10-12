import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Body1,
  Button,
  Caption1,
  makeStyles,
  mergeClasses,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Subtitle1,
  Textarea,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import { CheckmarkRegular, CopyRegular, FolderOpenRegular, SaveRegular } from "@fluentui/react-icons";
import { MONO } from "../theme";
import { timestamp } from "../format";
import { baseName } from "../settings";
import type { Job } from "../state/jobs";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: { minWidth: 0, display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalXXS },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalXS, flexShrink: 0 },
  body: { flex: 1, overflowY: "auto", padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}` },
  rows: { maxWidth: "820px", display: "flex", flexDirection: "column" },
  row: {
    display: "grid",
    gridTemplateColumns: "64px 1fr",
    columnGap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    marginLeft: `calc(-1 * ${tokens.spacingHorizontalS})`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "text",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  editing: { backgroundColor: tokens.colorSubtleBackgroundHover, cursor: "default" },
  time: {
    fontFamily: MONO,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase400,
    color: tokens.colorNeutralForeground3,
    paddingTop: "1px",
    fontVariantNumeric: "tabular-nums",
  },
  text: { lineHeight: tokens.lineHeightBase400, maxWidth: "68ch" },
  editor: { width: "100%" },
  hint: { color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXS },
  skeleton: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalL, maxWidth: "720px" },
  skeletonRow: { display: "grid", gridTemplateColumns: "64px 1fr", columnGap: tokens.spacingHorizontalL },
  placeholder: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.colorNeutralForeground3,
    padding: tokens.spacingHorizontalXXL,
    textAlign: "center",
  },
});

function SegmentEditor({ initial, onCommit, onCancel }: { initial: string; onCommit(t: string): void; onCancel(): void }) {
  const s = useStyles();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  return (
    <div>
      <Textarea
        ref={ref}
        className={s.editor}
        value={value}
        resize="vertical"
        onChange={(_, d) => setValue(d.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onCommit(value);
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        aria-label="Текст фрагмента"
      />
      <Caption1 className={s.hint} block>
        Enter сохраняет правку, Esc отменяет
      </Caption1>
    </div>
  );
}

function headerMeta(job: Job): string {
  switch (job.status) {
    case "queued":
      return "Ждёт своей очереди";
    case "running":
      return job.total ? `Распознано ${timestamp(job.done)} из ${timestamp(job.total)}` : "Загружаем модель в видеопамять";
    case "done":
      return job.srtPath ? `${timestamp(job.total)}, сохранено в ${baseName(job.srtPath)}` : timestamp(job.total);
    case "cancelled":
      return "Распознавание отменено";
    case "error":
      return "Не удалось распознать файл";
  }
}

type Props = {
  job: Job | undefined;
  onEdit(index: number, text: string): void;
  onSave(): void;
  onReveal(): void;
  saving: boolean;
};

export function TranscriptPane({ job, onEdit, onSave, onReveal, saving }: Props) {
  const s = useStyles();
  const [editing, setEditing] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setEditing(null);
    stick.current = true;
  }, [job?.id]);

  // While recognising, follow new text unless the user scrolled up to read.
  useEffect(() => {
    const el = body.current;
    if (el && job?.status === "running" && stick.current) el.scrollTop = el.scrollHeight;
  }, [job?.segments.length, job?.status]);

  if (!job) {
    return (
      <section className={mergeClasses(s.root, s.placeholder)}>
        <Body1>Выберите файл в очереди, чтобы увидеть текст</Body1>
      </section>
    );
  }

  const copyText = async () => {
    await navigator.clipboard.writeText(job.segments.map((x) => x.text.trim()).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className={s.root} aria-label="Текст расшифровки">
      <div className={s.header}>
        <div className={s.title}>
          <Subtitle1 className={s.name} title={job.path}>
            {baseName(job.path)}
          </Subtitle1>
          <Caption1 className={mergeClasses(s.meta, s.name)} title={job.srtPath ?? undefined}>
            {headerMeta(job)}
          </Caption1>
        </div>
        {job.status === "done" && (
          <div className={s.actions}>
            <Tooltip content={copied ? "Скопировано" : "Копировать текст"} relationship="label" visible={copied || undefined}>
              <Button appearance="subtle" icon={copied ? <CheckmarkRegular /> : <CopyRegular />} onClick={copyText} />
            </Tooltip>
            <Tooltip content="Показать SRT в папке" relationship="label">
              <Button appearance="subtle" icon={<FolderOpenRegular />} onClick={onReveal} disabled={!job.srtPath} />
            </Tooltip>
            <Button appearance="primary" icon={<SaveRegular />} onClick={onSave} disabled={!job.edited || saving}>
              {job.edited ? "Сохранить SRT" : "Сохранено"}
            </Button>
          </div>
        )}
      </div>

      <div
        className={s.body}
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {job.status === "error" && (
          <MessageBar intent="error">
            <MessageBarBody>{job.error}</MessageBarBody>
          </MessageBar>
        )}
        {(job.status === "queued" || (job.status === "running" && job.segments.length === 0)) && (
          <Skeleton className={s.skeleton} aria-label="Текст ещё не готов">
            {[92, 78, 85, 60].map((w) => (
              <div key={w} className={s.skeletonRow}>
                <SkeletonItem size={16} />
                <SkeletonItem size={16} style={{ width: `${w}%` }} />
              </div>
            ))}
          </Skeleton>
        )}
        <div className={s.rows}>
          {job.segments.map((seg, i) => {
            const canEdit = job.status === "done";
            const isEditing = editing === i;
            return (
              <div
                key={i}
                className={mergeClasses(s.row, isEditing && s.editing)}
                onClick={() => canEdit && !isEditing && setEditing(i)}
                style={canEdit ? undefined : { cursor: "default" }}
              >
                <span className={s.time}>{timestamp(seg.start)}</span>
                {isEditing ? (
                  <SegmentEditor
                    initial={seg.text.trim()}
                    onCommit={(t) => {
                      onEdit(i, " " + t.trim());
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <Body1 className={s.text}>{seg.text.trim()}</Body1>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
