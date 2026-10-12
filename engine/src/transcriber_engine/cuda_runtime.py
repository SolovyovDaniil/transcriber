"""CUDA libraries for ctranslate2 on Windows, downloaded on first run.

cuBLAS and cuDNN together are ~1.6 GB unpacked, which does not fit an NSIS installer
(2 GB limit) next to the rest of the engine. So the installer ships without them and
the app fetches NVIDIA's official pip wheels from PyPI, checks their SHA-256 and unpacks
only the DLLs ctranslate2 loads.
"""

from __future__ import annotations

import hashlib
import os
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Iterator

CHUNK = 1024 * 1024


@dataclass(frozen=True)
class Package:
    name: str
    url: str
    size: int
    sha256: str
    dlls: tuple[str, ...]


# Versions pinned with their PyPI hashes. ctranslate2 4.x needs CUDA 12 cuBLAS and cuDNN 9.
PACKAGES: tuple[Package, ...] = (
    Package(
        name="nvidia-cublas-cu12-12.9.2.10",
        url="https://files.pythonhosted.org/packages/20/e2/fc9a0e985249d873150276d5afb02e39a66817fedbf1a385724393e505ed/nvidia_cublas_cu12-12.9.2.10-py3-none-win_amd64.whl",
        size=553162896,
        sha256="623f43027d40d44ceadf0043f002bd25cf353e8f13ce90b9a87057019f560661",
        dlls=("cublas64_12.dll", "cublasLt64_12.dll"),
    ),
    Package(
        name="nvidia-cudnn-cu12-9.27.0.42",
        url="https://files.pythonhosted.org/packages/aa/38/f856579877f7c1c5066e61182e7de7bc27bf35a78c8d1b0fa592e6985bc4/nvidia_cudnn_cu12-9.27.0.42-py3-none-win_amd64.whl",
        size=743068852,
        sha256="06e9b0026f3bad97d2b58666330fabec04fe1672f776661ecb0ce0029c27f142",
        # cudnn_adv64_9.dll (RNN/attention, 271 MB) is not used for Whisper's convolutions.
        dlls=(
            "cudnn64_9.dll",
            "cudnn_cnn64_9.dll",
            "cudnn_ops64_9.dll",
            "cudnn_graph64_9.dll",
            "cudnn_heuristic64_9.dll",
            "cudnn_engines_precompiled64_9.dll",
            "cudnn_engines_runtime_compiled64_9.dll",
            "cudnn_engines_tensor_ir64_9.dll",
            "cudnn_ext64_9.dll",
        ),
    ),
)

DOWNLOAD_SIZE = sum(p.size for p in PACKAGES)


class IntegrityError(Exception):
    pass


def default_dir() -> Path:
    if env := os.environ.get("TRANSCRIBER_CUDA_DIR"):
        return Path(env)
    if local := os.environ.get("LOCALAPPDATA"):
        return Path(local) / "Transcriber" / "cuda"
    return Path.home() / ".cache" / "transcriber" / "cuda"


def _installed(pkg: Package, dirs: Iterable[Path]) -> bool:
    dirs = list(dirs)
    return all(any((d / dll).is_file() for d in dirs) for dll in pkg.dlls)


def is_installed(target: Path, packages: Iterable[Package] = PACKAGES) -> bool:
    return all(_installed(p, [target]) for p in packages)


def status(device: str, dirs: Iterable[Path], packages: Iterable[Package] = PACKAGES, platform: str = sys.platform) -> str:
    """'not_needed' (no NVIDIA GPU), 'ready', or 'missing' (download required)."""
    if device != "cuda":
        return "not_needed"
    if platform != "win32":
        return "ready"  # Linux/dev: system or pip-installed libraries
    dirs = list(dirs)
    return "ready" if all(_installed(p, dirs) for p in packages) else "missing"


def _fetch(url: str) -> Iterator[bytes]:
    import urllib.request

    with urllib.request.urlopen(url, timeout=60) as resp:
        while chunk := resp.read(CHUNK):
            yield chunk


def install(
    target: Path,
    on_progress: Callable[[int, int], None],
    packages: Iterable[Package] = PACKAGES,
    fetch: Callable[[str], Iterable[bytes]] = _fetch,
) -> None:
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    todo = [p for p in packages if not _installed(p, [target])]
    total = sum(p.size for p in todo)
    done = 0
    for pkg in todo:
        part = target / f"{pkg.name}.whl.part"
        try:
            sha = hashlib.sha256()
            with part.open("wb") as f:
                for chunk in fetch(pkg.url):
                    f.write(chunk)
                    sha.update(chunk)
                    done += len(chunk)
                    on_progress(min(done, total), total)
            if sha.hexdigest() != pkg.sha256:
                raise IntegrityError(f"{pkg.name}: контрольная сумма не совпала, файл повреждён при загрузке")
            _extract(part, pkg, target)
        finally:
            part.unlink(missing_ok=True)
    on_progress(total, total)


class Runtime:
    """What the server needs: current status and an install that makes the DLLs loadable."""

    def __init__(self, target: Path, device: str, search: Callable[[], list[Path]], activate: Callable[[list[Path]], None]):
        self.target = Path(target)
        self.device = device
        self._search = search
        self._activate = activate

    def status(self) -> str:
        return status(self.device, [self.target, *self._search()])

    def install(self, on_progress: Callable[[int, int], None]) -> None:
        install(self.target, on_progress)
        self._activate([self.target])


def _extract(wheel: Path, pkg: Package, target: Path) -> None:
    with zipfile.ZipFile(wheel) as z:
        by_name = {Path(i.filename).name: i for i in z.infolist() if "/bin/" in i.filename}
        missing = [d for d in pkg.dlls if d not in by_name]
        if missing:
            raise IntegrityError(f"{pkg.name}: в пакете нет {', '.join(missing)}")
        for dll in pkg.dlls:
            tmp = target / (dll + ".tmp")
            with z.open(by_name[dll]) as src, tmp.open("wb") as dst:
                while chunk := src.read(CHUNK):
                    dst.write(chunk)
            os.replace(tmp, target / dll)
