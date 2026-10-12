import {
  Body1,
  Button,
  Caption1,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  makeStyles,
  mergeClasses,
  OverlayDrawer,
  Radio,
  RadioGroup,
  Subtitle2,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, DismissRegular } from "@fluentui/react-icons";
import { MODEL_INFO, size } from "../format";
import type { ModelEntry, SystemInfo } from "../engine/protocol";
import type { Settings } from "../settings";
import type { Download } from "../useEngine";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalXXL, paddingBottom: tokens.spacingVerticalXXL },
  section: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalS },
  folder: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS, marginLeft: "32px" },
  path: { color: tokens.colorNeutralForeground2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  facts: { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, margin: 0 },
  dt: { color: tokens.colorNeutralForeground3 },
  dd: { margin: 0 },
  modelRow: { display: "flex", alignItems: "center", justifyContent: "space-between", columnGap: tokens.spacingHorizontalM },
  nowrap: { whiteSpace: "nowrap", flexShrink: 0 },
  note: { color: tokens.colorNeutralForeground3 },
});

const COMPUTE_LABEL: Record<string, string> = {
  float16: "float16 (полная точность на GPU)",
  int8_float16: "int8_float16 (экономия видеопамяти)",
  int8: "int8",
};

type Props = {
  open: boolean;
  onClose(): void;
  settings: Settings;
  onChange(patch: Partial<Settings>): void;
  model: string;
  models: ModelEntry[];
  system: SystemInfo | null;
  download: Download | null;
  onDownload(model: string): void;
  onPickFolder(): void;
};

export function SettingsDrawer(p: Props) {
  const s = useStyles();
  const gpu = p.system?.gpus[0];
  const choices = p.models.filter((m) => m.name in MODEL_INFO);

  return (
    <OverlayDrawer position="end" size="medium" open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" aria-label="Закрыть" icon={<DismissRegular />} onClick={p.onClose} />}
        >
          Настройки
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={s.body}>
        <div className={s.section}>
          <Subtitle2 as="h2">Качество распознавания</Subtitle2>
          <RadioGroup value={p.model} onChange={(_, d) => p.onChange({ model: d.value })}>
            {choices.map((m) => (
              <div key={m.name} className={s.modelRow}>
                <Radio
                  value={m.name}
                  disabled={!m.downloaded}
                  label={
                    <span>
                      <Body1 block>{MODEL_INFO[m.name].title}</Body1>
                      <Caption1 className={s.note}>
                        {MODEL_INFO[m.name].note}
                        {m.downloaded ? "" : ` Не скачана, ${size(m.size_mb * 1024 * 1024)}.`}
                      </Caption1>
                    </span>
                  }
                />
                {!m.downloaded &&
                  (p.download?.model === m.name && !p.download.error ? (
                    <Caption1 className={mergeClasses(s.note, s.nowrap)}>
                      {p.download.total ? `${Math.round((p.download.downloaded / p.download.total) * 100)}%` : "..."}
                    </Caption1>
                  ) : (
                    <Button
                      size="small"
                      icon={<ArrowDownloadRegular />}
                      onClick={() => p.onDownload(m.name)}
                      disabled={!!p.download && !p.download.error}
                      title={`Скачать модель, ${size(m.size_mb * 1024 * 1024)}`}
                    >
                      Скачать
                    </Button>
                  ))}
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className={s.section}>
          <Subtitle2 as="h2">Куда сохранять SRT</Subtitle2>
          <RadioGroup
            value={p.settings.outputDir ? "folder" : "next"}
            onChange={(_, d) => (d.value === "next" ? p.onChange({ outputDir: null }) : p.onPickFolder())}
          >
            <Radio value="next" label="Рядом с исходным файлом" />
            <Radio value="folder" label="В отдельную папку" />
          </RadioGroup>
          {p.settings.outputDir && (
            <div className={s.folder}>
              <Body1 className={s.path} title={p.settings.outputDir}>
                {p.settings.outputDir}
              </Body1>
              <Button size="small" onClick={p.onPickFolder}>
                Изменить
              </Button>
            </div>
          )}
        </div>

        <div className={s.section}>
          <Subtitle2 as="h2">Имена и термины</Subtitle2>
          <Field hint="Через запятую. Whisper будет чаще писать их правильно. Применяется к новым файлам.">
            <Textarea
              value={p.settings.prompt}
              onChange={(_, d) => p.onChange({ prompt: d.value })}
              aria-label="Имена и термины"
              placeholder="Например: Росводоканал, Мытищи, СНиП"
              resize="vertical"
              rows={3}
            />
          </Field>
        </div>

        <div className={s.section}>
          <Subtitle2 as="h2">Система</Subtitle2>
          <dl className={s.facts}>
            <dt className={s.dt}>Видеокарта</dt>
            <dd className={s.dd}>{gpu ? gpu.name : "NVIDIA не найдена, работа на процессоре"}</dd>
            {gpu && (
              <>
                <dt className={s.dt}>Видеопамять</dt>
                <dd className={s.dd}>{size(gpu.vram_total_mb * 1024 * 1024)}</dd>
              </>
            )}
            <dt className={s.dt}>Точность</dt>
            <dd className={s.dd}>{COMPUTE_LABEL[p.system?.compute_types[0] ?? ""] ?? "..."}</dd>
            <dt className={s.dt}>Версия движка</dt>
            <dd className={s.dd}>{p.system?.version ?? "..."}</dd>
          </dl>
        </div>
      </DrawerBody>
    </OverlayDrawer>
  );
}
