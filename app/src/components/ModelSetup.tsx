import { useState } from "react";
import {
  Badge,
  Body1,
  Button,
  Caption1,
  makeStyles,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Subtitle1,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { MODEL_INFO, size } from "../format";
import type { ModelEntry } from "../engine/protocol";
import type { Download } from "../useEngine";

const useStyles = makeStyles({
  root: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: tokens.spacingHorizontalXXL },
  panel: { width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalL },
  lead: { color: tokens.colorNeutralForeground2 },
  part: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalXS },
  partTitle: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS },
  option: { display: "flex", flexDirection: "column", rowGap: "2px", paddingBottom: tokens.spacingVerticalXS },
  note: { color: tokens.colorNeutralForeground3 },
  progress: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalS },
  row: { display: "flex", justifyContent: "space-between", color: tokens.colorNeutralForeground2 },
});

type Props = {
  models: ModelEntry[];
  needModel: boolean;
  cudaMissing: boolean;
  cudaSize: number;
  initial: string;
  download: Download | null;
  onStart(model: string | null): void;
};

export function ModelSetup({ models, needModel, cudaMissing, cudaSize, initial, download, onStart }: Props) {
  const s = useStyles();
  const choices = models.filter((m) => m.name in MODEL_INFO);
  const [choice, setChoice] = useState(initial);
  const active = download && !download.error ? download : null;
  const chosen = choices.find((m) => m.name === choice);
  const totalBytes = (cudaMissing ? cudaSize : 0) + (needModel && chosen ? chosen.size_mb * 1024 * 1024 : 0);

  const activeLabel =
    active?.kind === "cuda" ? "Библиотеки NVIDIA CUDA" : active ? `Модель ${active.model}` : "";

  return (
    <section className={s.root} aria-label="Первоначальная настройка">
      <div className={s.panel}>
        <Subtitle1 as="h1">{needModel ? "Скачайте модель распознавания" : "Скачайте библиотеки для видеокарты"}</Subtitle1>
        <Body1 className={s.lead}>
          Это нужно один раз, всего {size(totalBytes)}. Дальше расшифровка работает без интернета, записи
          никуда не отправляются.
        </Body1>

        {cudaMissing && (
          <div className={s.part}>
            <span className={s.partTitle}>
              <Body1>Библиотеки NVIDIA CUDA</Body1>
            </span>
            <Caption1 className={s.note}>
              cuBLAS и cuDNN, без них видеокарта не участвует в распознавании. Размер {size(cudaSize)}.
            </Caption1>
          </div>
        )}

        {needModel && (
          <RadioGroup value={choice} onChange={(_, d) => setChoice(d.value)} disabled={!!active} aria-label="Модель">
            {choices.map((m) => (
              <Radio
                key={m.name}
                value={m.name}
                label={
                  <span className={s.option}>
                    <span className={s.partTitle}>
                      <Body1>{MODEL_INFO[m.name].title}</Body1>
                      {m.recommended && (
                        <Badge appearance="tint" color="brand" size="small">
                          Рекомендуется
                        </Badge>
                      )}
                    </span>
                    <Caption1 className={s.note}>
                      {MODEL_INFO[m.name].note} Размер {size(m.size_mb * 1024 * 1024)}.
                    </Caption1>
                  </span>
                }
              />
            ))}
          </RadioGroup>
        )}

        {download?.error && (
          <MessageBar intent="error">
            <MessageBarBody>Загрузка прервалась: {download.error}</MessageBarBody>
          </MessageBar>
        )}

        {active ? (
          <div className={s.progress}>
            <ProgressBar value={active.total ? active.downloaded / active.total : undefined} thickness="large" />
            <Caption1 className={s.row}>
              <span>Скачивается: {activeLabel}</span>
              <span>{active.total ? `${size(active.downloaded)} из ${size(active.total)}` : "Подключение"}</span>
            </Caption1>
          </div>
        ) : (
          <div>
            <Button
              appearance="primary"
              size="large"
              icon={<ArrowDownloadRegular />}
              onClick={() => onStart(needModel ? choice : null)}
            >
              {download?.error ? "Повторить" : "Скачать"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
