# PyInstaller spec: one-folder build of the engine.
#   pyinstaller packaging/engine.spec --noconfirm   (run from engine/)
# Output: dist/transcriber-engine/transcriber-engine(.exe) + _internal/
# On Windows the cuBLAS/cuDNN DLLs from the nvidia-*-cu12 pip packages are copied
# into _internal/, where runtime.setup_dll_search_path() finds them.

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

datas = collect_data_files("faster_whisper")  # Silero VAD model (assets/*.onnx)
binaries = collect_dynamic_libs("ctranslate2")

if sys.platform == "win32":
    for entry in map(Path, sys.path):
        for pkg in ("cublas", "cudnn"):
            for dll in (entry / "nvidia" / pkg / "bin").glob("*.dll"):
                binaries.append((str(dll), "."))

a = Analysis(
    ["entry.py"],
    binaries=binaries,
    datas=datas,
    hiddenimports=["transcriber_engine"],
    excludes=["tkinter", "matplotlib", "IPython", "pytest"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="transcriber-engine",
    console=True,  # stdio is the protocol; the app spawns it without a window
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="transcriber-engine", upx=False)
