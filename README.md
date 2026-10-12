# Transcriber

Офлайн-приложение для Windows, которое расшифровывает аудио и видео моделью Whisper
large-v3 на видеокарте (рассчитано на RTX 4060, 8 ГБ).

- Техническое задание: [docs/TZ.md](docs/TZ.md)
- Планы по этапам: [docs/plans/](docs/plans/)

## Структура

| Папка | Что внутри | Статус |
|---|---|---|
| `engine/` | Python-движок на faster-whisper, протокол JSON Lines по stdio | этап 1 готов |
| `app/` | Оболочка Tauri 2 + UI на React | этапы 3–5 |

## Движок: быстрый старт (Windows)

```powershell
cd engine
py -3.11 -m venv .venv
.venv\Scripts\pip install -e ".[dev,docx]"
.venv\Scripts\pytest

# Проверить видеокарту и рекомендуемую модель
.venv\Scripts\transcriber-engine info

# Расшифровать файл (модель скачается при первом запуске, ~3 ГБ для large-v3)
.venv\Scripts\transcriber-engine transcribe interview.mp3 --language ru --format srt -o interview.srt
```

Для работы на GPU нужны драйвер NVIDIA и библиотеки CUDA 12 (cuBLAS) и cuDNN 9.
Проще всего поставить их в то же окружение:

```powershell
.venv\Scripts\pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*
```

В сборке приложения (этап 2) эти библиотеки будут лежать внутри движка.
