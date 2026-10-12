"""Make CUDA/cuDNN DLLs findable on Windows before ctranslate2 loads them.

ctranslate2.dll loads cuBLAS and cuDNN lazily by name, so they must be on the DLL
search path. They come from the folder the app downloads them to (cuda_runtime), or
from the nvidia-cublas-cu12 / nvidia-cudnn-cu12 pip packages in a dev venv.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def cuda_dll_dirs(roots: list[Path]) -> list[Path]:
    """Directories under `roots` that contain DLLs: each root itself and <root>/nvidia/*/bin."""
    found = []
    for root in roots:
        candidates = [root, *sorted((root / "nvidia").glob("*/bin"))]
        for d in candidates:
            if d.is_dir() and any(d.glob("*.dll")) and d not in found:
                found.append(d)
    return found


def _roots(extra: list[Path]) -> list[Path]:
    roots = list(extra)
    if getattr(sys, "frozen", False):
        roots.append(Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)))
    roots.extend(Path(p) for p in sys.path if p and Path(p).name == "site-packages")
    return roots


def search_dirs(extra: list[Path]) -> list[Path]:
    """Directories that hold CUDA DLLs right now (re-scanned on every call)."""
    return cuda_dll_dirs(_roots(extra))


def activate(dirs: list[Path]) -> None:
    if sys.platform != "win32":
        return
    for d in dirs:
        os.add_dll_directory(str(d))
    # LoadLibrary without LOAD_LIBRARY_SEARCH_USER_DIRS only looks at PATH.
    os.environ["PATH"] = os.pathsep.join([*map(str, dirs), os.environ.get("PATH", "")])


def setup_dll_search_path(extra: list[Path]) -> list[Path]:
    dirs = search_dirs(extra) if sys.platform == "win32" else []
    activate(dirs)
    return dirs
