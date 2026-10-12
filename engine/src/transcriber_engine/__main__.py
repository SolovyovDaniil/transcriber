"""Entry point.

    transcriber-engine                 # stdio JSON Lines server for the desktop app
    transcriber-engine transcribe FILE [--model large-v3] [--format srt] [-o OUT]
    transcriber-engine info
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from pathlib import Path

from . import __version__, formats, hardware, models
from .runtime import setup_dll_search_path
from .server import Server
from .store import ModelStore
from .transcriber import Options, Transcriber


def default_models_dir() -> Path:
    if env := os.environ.get("TRANSCRIBER_MODELS_DIR"):
        return Path(env)
    if local := os.environ.get("LOCALAPPDATA"):
        return Path(local) / "Transcriber" / "models"
    return Path.home() / ".cache" / "transcriber" / "models"


def serve(models_dir: Path) -> int:
    # Pipes on Windows default to the ANSI code page; the protocol is UTF-8.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    lock = threading.Lock()

    def write(line: str) -> None:
        with lock:
            sys.stdout.write(line)
            sys.stdout.flush()

    system = hardware.detect()
    server = Server(
        write,
        system,
        Transcriber(system, str(models_dir)),
        ModelStore(models_dir),
        version=__version__,
    )
    try:
        for line in sys.stdin:
            if line.strip() and not server.handle_line(line):
                break
    finally:
        server.close()
    return 0


def transcribe_cli(args: argparse.Namespace, models_dir: Path) -> int:
    system = hardware.detect()
    model = args.model or models.recommend(system.device, system.vram_total_mb)
    options = Options(model=model)
    output = Path(args.output) if args.output else Path(args.file).with_suffix("." + args.format)
    print(f"device={system.device} model={model}", file=sys.stderr)

    def progress(done: float, total: float) -> None:
        print(f"\r{done:7.1f}/{total:.1f}s", end="", file=sys.stderr, flush=True)

    transcript = Transcriber(system, str(models_dir)).transcribe(
        args.file,
        options,
        on_progress=progress,
        on_segment=lambda seg: None,
        on_reset=lambda ct: print(f"\nout of memory, retrying with {ct}", file=sys.stderr),
        is_cancelled=lambda: False,
    )
    print(file=sys.stderr)
    formats.write(transcript, args.format, output)
    print(f"saved {output}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    setup_dll_search_path()
    parser = argparse.ArgumentParser(prog="transcriber-engine")
    parser.add_argument("--models-dir", type=Path, default=default_models_dir())
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="stdio JSON Lines server (default)")
    sub.add_parser("info", help="print detected hardware and recommended model")
    t = sub.add_parser("transcribe", help="transcribe one file")
    t.add_argument("file")
    t.add_argument("--model", choices=list(models.CATALOG))
    t.add_argument("--format", choices=list(formats.FORMATS), default="srt")
    t.add_argument("--output", "-o", help="default: next to FILE with the format's extension")
    args = parser.parse_args(argv)

    if args.command == "transcribe":
        return transcribe_cli(args, args.models_dir)
    if args.command == "info":
        system = hardware.detect()
        print(
            json.dumps(
                {
                    "device": system.device,
                    "gpus": [g.__dict__ for g in system.gpus],
                    "recommended_model": models.recommend(system.device, system.vram_total_mb),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    return serve(args.models_dir)


if __name__ == "__main__":
    sys.exit(main())
