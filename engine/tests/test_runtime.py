from transcriber_engine.runtime import cuda_dll_dirs


def touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")


def test_finds_frozen_root_and_nvidia_pip_packages(tmp_path):
    frozen = tmp_path / "_internal"
    touch(frozen / "cublas64_12.dll")
    site = tmp_path / "site-packages"
    touch(site / "nvidia" / "cudnn" / "bin" / "cudnn64_9.dll")
    touch(site / "nvidia" / "cublas" / "bin" / "cublas64_12.dll")
    touch(site / "nvidia" / "cuda_nvrtc" / "include" / "x.h")  # no bin dir

    assert cuda_dll_dirs([frozen, site]) == [
        frozen,
        site / "nvidia" / "cublas" / "bin",
        site / "nvidia" / "cudnn" / "bin",
    ]


def test_ignores_missing_and_dll_less_dirs(tmp_path):
    (tmp_path / "empty").mkdir()
    assert cuda_dll_dirs([tmp_path / "empty", tmp_path / "missing"]) == []
