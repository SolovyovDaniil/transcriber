# PyInstaller spec: one-folder build of the engine.
#   pyinstaller packaging/engine.spec --noconfirm   (run from engine/)
# Output: dist/transcriber-engine/transcriber-engine(.exe) + _internal/
# CUDA libraries are NOT bundled (cuBLAS + cuDNN do not fit the 2 GB NSIS limit);
# the app downloads them on first run, see transcriber_engine/cuda_runtime.py.

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

datas = collect_data_files("faster_whisper")  # Silero VAD model (assets/*.onnx)
binaries = collect_dynamic_libs("ctranslate2")

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
