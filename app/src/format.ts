/** 3725.4 -> "1:02:05", 65 -> "1:05" */
export function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 3250585600 bytes -> "3,0 ГБ"; 524288000 -> "500 МБ" */
export function size(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${Math.round(mb)}\u00a0МБ`;
  return `${(mb / 1024).toFixed(1).replace(".", ",")}\u00a0ГБ`;
}

export const MODEL_INFO: Record<string, { title: string; note: string }> = {
  "large-v3": { title: "Максимальное качество", note: "Модель large-v3. Меньше всего ошибок в русской речи." },
  "large-v3-turbo": { title: "Быстрое", note: "Модель large-v3-turbo. В 3-4 раза быстрее, ошибок немного больше." },
};
