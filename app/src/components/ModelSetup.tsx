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
  option: { display: "flex", flexDirection: "column", rowGap: "2px", paddingBottom: tokens.spacingVerticalXS },
  optionTitle: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS },
  note: { color: tokens.colorNeutralForeground3 },
  progress: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalS },
  row: { display: "flex", justifyContent: "space-between", color: tokens.colorNeutralForeground2 },
});

type Props = {
  models: ModelEntry[];
  initial: string;
  download: Download | null;
  onDownload(model: string): void;
};

export function ModelSetup({ models, initial, download, onDownload }: Props) {
  const s = useStyles();
  const choices = models.filter((m) => m.name in MODEL_INFO);
  const [choice, setChoice] = useState(initial);
  const active = download && !download.error ? download : null;

  return (
    <section className={s.root} aria-label="Скачивание модели">
      <div className={s.panel}>
        <Subtitle1 as="h1">Скачайте модель распознавания</Subtitle1>
        <Body1 className={s.lead}>
          Это нужно один раз. Дальше расшифровка работает без интернета, записи никуда не отправляются.
        </Body1>

        <RadioGroup value={choice} onChange={(_, d) => setChoice(d.value)} disabled={!!active}>
          {choices.map((m) => (
            <Radio
              key={m.name}
              value={m.name}
              label={
                <span className={s.option}>
                  <span className={s.optionTitle}>
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

        {download?.error && (
          <MessageBar intent="error">
            <MessageBarBody>Загрузка прервалась: {download.error}</MessageBarBody>
          </MessageBar>
        )}

        {active ? (
          <div className={s.progress}>
            <ProgressBar value={active.total ? active.downloaded / active.total : undefined} thickness="large" />
            <Caption1 className={s.row}>
              <span>Скачивается модель {active.model}</span>
              <span>{active.total ? `${size(active.downloaded)} из ${size(active.total)}` : "Подключение"}</span>
            </Caption1>
          </div>
        ) : (
          <div>
            <Button appearance="primary" size="large" icon={<ArrowDownloadRegular />} onClick={() => onDownload(choice)}>
              {download?.error ? "Повторить" : "Скачать"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
