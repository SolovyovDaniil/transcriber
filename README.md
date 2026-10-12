# Transcriber

Офлайн-приложение для Windows: русская речь из аудио и видео → субтитры SRT. Модель Whisper
large-v3 на видеокарте (рассчитано на RTX 4060, 8 ГБ).

- Техническое задание: [docs/TZ.md](docs/TZ.md)
- Планы по этапам: [docs/plans/](docs/plans/)

## Структура

| Папка | Что внутри | Статус |
|---|---|---|
| `engine/` | Python-движок на faster-whisper, протокол JSON Lines по stdio | этапы 1–2 готовы |
| `app/` | Оболочка Tauri 2 + UI на React | этапы 3–5 |

## Движок: быстрый старт (Windows)

```powershell
cd engine
py -3.11 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.venv\Scripts\pytest

# Проверить видеокарту и рекомендуемую модель
.venv\Scripts\transcriber-engine info

# Расшифровать файл (модель скачается при первом запуске, ~3 ГБ для large-v3)
.venv\Scripts\transcriber-engine transcribe interview.mp3   # → interview.srt рядом с файлом
```

Для работы на GPU нужны драйвер NVIDIA и библиотеки CUDA 12 (cuBLAS) и cuDNN 9.
Проще всего поставить их в то же окружение:

```powershell
.venv\Scripts\pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*
```

В собранном `.exe` эти библиотеки уже лежат внутри.

## Сборка движка в `.exe` (Windows)

```powershell
cd engine
.venv\Scripts\pip install . -r packaging\requirements-gpu.txt
.venv\Scripts\pyinstaller packaging\engine.spec --noconfirm
dist\transcriber-engine\transcriber-engine.exe info
```

Готовая сборка (папка `transcriber-engine/` с DLL от CUDA и cuDNN) также собирается
в GitHub Actions — артефакт `transcriber-engine-windows` в workflow `engine`.
