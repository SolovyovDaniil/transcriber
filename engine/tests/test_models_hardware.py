import subprocess

import pytest

from transcriber_engine import hardware, models

NVIDIA_SMI_4060 = "NVIDIA GeForce RTX 4060, 8188, 7420, 560.94\n"


def test_catalog_contains_default_and_fast_models():
    assert models.DEFAULT_MODEL == "large-v3"
    assert models.FAST_MODEL == "large-v3-turbo"
    assert models.get("large-v3").repo == "Systran/faster-whisper-large-v3"
    with pytest.raises(KeyError):
        models.get("huge")


@pytest.mark.parametrize(
    ("device", "vram_mb", "expected"),
    [
        ("cuda", 8188, ["float16", "int8_float16", "int8"]),  # RTX 4060
        ("cuda", 5000, ["int8_float16", "int8"]),
        ("cuda", 2000, ["int8"]),
        ("cuda", None, ["float16", "int8_float16", "int8"]),  # unknown VRAM: try, fall back on OOM
        ("cpu", None, ["int8"]),
    ],
)
def test_compute_chain_for_large_v3(device, vram_mb, expected):
    assert models.compute_chain("large-v3", device, vram_mb) == expected


def test_recommend_model():
    assert models.recommend("cuda", 8188) == "large-v3"
    assert models.recommend("cuda", 4096) == "large-v3-turbo"
    assert models.recommend("cpu", None) == "large-v3-turbo"


def test_parse_nvidia_smi():
    gpus = hardware.parse_nvidia_smi(NVIDIA_SMI_4060 + "Other GPU, 4096, 4000, 560.94\n")
    assert gpus[0] == hardware.Gpu("NVIDIA GeForce RTX 4060", 8188, 7420, "560.94")
    assert len(gpus) == 2


def test_parse_nvidia_smi_ignores_garbage():
    assert hardware.parse_nvidia_smi("\nNo devices were found\n") == []


def test_detect_with_cuda():
    info = hardware.detect(
        cuda_count=lambda: 1,
        run=lambda cmd: NVIDIA_SMI_4060,
    )
    assert info.device == "cuda"
    assert info.vram_total_mb == 8188
    assert info.gpus[0].name == "NVIDIA GeForce RTX 4060"


def test_detect_without_nvidia_smi_or_cuda():
    def missing(cmd):
        raise FileNotFoundError

    info = hardware.detect(cuda_count=lambda: 0, run=missing)
    assert info.device == "cpu"
    assert info.gpus == ()
    assert info.vram_total_mb is None


def test_detect_survives_nvidia_smi_failure():
    def failing(cmd):
        raise subprocess.CalledProcessError(1, cmd)

    info = hardware.detect(cuda_count=lambda: 1, run=failing)
    assert info.device == "cuda"
    assert info.vram_total_mb is None
