"""Make CUDA/cuDNN DLLs findable on Windows before ctranslate2 loads them.

ctranslate2.dll loads cuBLAS and cuDNN lazily by name, so they must be on the DLL
search path. We ship them either next to the frozen engine (PyInstaller) or get them
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


def _roots() -> list[Path]:
    roots = []
    if getattr(sys, "frozen", False):
        roots.append(Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)))
    roots.extend(Path(p) for p in sys.path if p and Path(p).name == "site-packages")
    return roots


def setup_dll_search_path() -> list[Path]:
    if sys.platform != "win32":
        return []
    dirs = cuda_dll_dirs(_roots())
    for d in dirs:
        os.add_dll_directory(str(d))
    # LoadLibrary without LOAD_LIBRARY_SEARCH_USER_DIRS only looks at PATH.
    os.environ["PATH"] = os.pathsep.join([*map(str, dirs), os.environ.get("PATH", "")])
    return dirs
