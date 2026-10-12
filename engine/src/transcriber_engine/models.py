"""Whisper model catalog and compute-type selection for the available GPU."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelInfo:
    name: str
    repo: str
    size_mb: int  # download size
    vram_fp16_mb: int  # peak VRAM with float16, beam 5
    vram_int8_mb: int  # peak VRAM with int8_float16
    translate: bool  # handles task="translate" well


CATALOG: dict[str, ModelInfo] = {
    m.name: m
    for m in (
        ModelInfo("large-v3", "Systran/faster-whisper-large-v3", 3100, 5000, 3000, True),
        ModelInfo(
            "large-v3-turbo", "mobiuslabsgmbh/faster-whisper-large-v3-turbo", 1600, 3000, 2000, False
        ),
        ModelInfo("medium", "Systran/faster-whisper-medium", 1500, 2500, 1500, True),
        ModelInfo("small", "Systran/faster-whisper-small", 480, 1200, 800, True),
    )
}

DEFAULT_MODEL = "large-v3"
FAST_MODEL = "large-v3-turbo"

# VRAM left for the OS, browser and display while transcribing.
HEADROOM_MB = 1500


def get(name: str) -> ModelInfo:
    return CATALOG[name]


def compute_chain(name: str, device: str, vram_total_mb: int | None) -> list[str]:
    """Compute types to try in order; later entries are the fallback on CUDA OOM."""
    if device != "cuda":
        return ["int8"]
    model = get(name)
    if vram_total_mb is None or vram_total_mb >= model.vram_fp16_mb + HEADROOM_MB:
        return ["float16", "int8_float16", "int8"]
    if vram_total_mb >= model.vram_int8_mb + HEADROOM_MB:
        return ["int8_float16", "int8"]
    return ["int8"]


def recommend(device: str, vram_total_mb: int | None) -> str:
    """Most accurate model that runs comfortably on this machine."""
    if device == "cuda" and (vram_total_mb or 0) >= get(DEFAULT_MODEL).vram_fp16_mb + HEADROOM_MB:
        return DEFAULT_MODEL
    return FAST_MODEL
