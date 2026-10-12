# Transcriber

Офлайн-приложение для Windows: русская речь из аудио и видео → субтитры SRT. Модель Whisper
large-v3 на видеокарте (рассчитано на RTX 4060, 8 ГБ).

- Техническое задание: [docs/TZ.md](docs/TZ.md)
- Планы по этапам: [docs/plans/](docs/plans/)

## Структура

| Папка | Что внутри | Статус |
|---|---|---|
| `engine/` | Python-движок на faster-whisper, протокол JSON Lines по stdio | этапы 1–2 готовы |
| `app/` | Оболочка Tauri 2 (Rust) + интерфейс на React и Fluent UI | этапы 3-5 готовы, дизайн: [docs/design.md](docs/design.md) |

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

В собранном приложении их скачивает само приложение при первом запуске (см. ниже).

## Сборка движка в `.exe` (Windows)

```powershell
cd engine
.venv\Scripts\pip install . -r packaging\requirements-build.txt
.venv\Scripts\pyinstaller packaging\engine.spec --noconfirm
dist\transcriber-engine\transcriber-engine.exe info
```

Библиотеки CUDA (cuBLAS, cuDNN, ~1,6 ГБ) в сборку не входят: вместе с движком они не
помещаются в установщик NSIS (предел 2 ГБ). Приложение скачивает их при первом запуске
с PyPI (официальные пакеты NVIDIA, с проверкой SHA-256) в `%LOCALAPPDATA%\Transcriber\cuda`.

Готовая сборка также собирается в GitHub Actions: артефакт `transcriber-engine-windows`
в workflow `engine`.

## Приложение: запуск в режиме разработки (Windows)

Нужны Node.js 22, Rust (stable) и движок, установленный в `engine/.venv` (см. выше) —
в отладочной сборке приложение запускает его как `python -m transcriber_engine`.

```powershell
cd app
npm ci
npx tauri dev
```

Тесты: `npx vitest run` (UI-логика) и `cargo test` в `app/src-tauri` (мост к движку).

## Установщик

`npx tauri build --config src-tauri/tauri.release.conf.json` после сборки движка в
`engine/dist/` кладёт движок внутрь приложения и собирает NSIS-установщик.
В CI это делает workflow `app` — артефакт `transcriber-setup-windows`.
