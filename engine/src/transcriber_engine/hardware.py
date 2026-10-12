"""Detect NVIDIA GPUs and their VRAM."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Callable

NVIDIA_SMI_CMD = [
    "nvidia-smi",
    "--query-gpu=name,memory.total,memory.free,driver_version",
    "--format=csv,noheader,nounits",
]


@dataclass(frozen=True)
class Gpu:
    name: str
    vram_total_mb: int
    vram_free_mb: int
    driver: str


@dataclass(frozen=True)
class SystemInfo:
    device: str  # "cuda" or "cpu"
    gpus: tuple[Gpu, ...]

    @property
    def vram_total_mb(self) -> int | None:
        return self.gpus[0].vram_total_mb if self.gpus else None


def parse_nvidia_smi(output: str) -> list[Gpu]:
    gpus = []
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 4:
            continue
        name, total, free, driver = parts
        try:
            gpus.append(Gpu(name, int(total), int(free), driver))
        except ValueError:
            continue
    return gpus


def _cuda_device_count() -> int:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count()
    except Exception:
        return 0


def _run(cmd: list[str]) -> str:
    # CREATE_NO_WINDOW keeps a console from flashing on Windows.
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(
        cmd, capture_output=True, text=True, check=True, timeout=10, creationflags=flags
    ).stdout


def detect(
    cuda_count: Callable[[], int] = _cuda_device_count,
    run: Callable[[list[str]], str] = _run,
) -> SystemInfo:
    device = "cuda" if cuda_count() > 0 else "cpu"
    try:
        gpus = tuple(parse_nvidia_smi(run(NVIDIA_SMI_CMD)))
    except (OSError, subprocess.SubprocessError):
        gpus = ()
    return SystemInfo(device=device, gpus=gpus)
