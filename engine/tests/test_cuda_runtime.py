import hashlib
import io
import zipfile

import pytest

from transcriber_engine import cuda_runtime
from transcriber_engine.cuda_runtime import Package


def make_wheel(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


CUBLAS = make_wheel(
    {
        "nvidia/cublas/bin/cublas64_12.dll": b"a" * 300,
        "nvidia/cublas/bin/nvblas64_12.dll": b"skip",
        "nvidia/cublas/include/cublas.h": b"header",
    }
)
CUDNN = make_wheel(
    {
        "nvidia/cudnn/bin/cudnn64_9.dll": b"b" * 200,
        "nvidia/cudnn/bin/cudnn_adv64_9.dll": b"too big, not needed",
    }
)


def pkg(name: str, data: bytes, sha: str | None = None, dlls=None) -> Package:
    return Package(
        name=name,
        url=f"https://example.invalid/{name}.whl",
        size=len(data),
        sha256=sha or hashlib.sha256(data).hexdigest(),
        dlls=dlls,
    )


class FakeHttp:
    def __init__(self, blobs: dict[str, bytes], chunk=64):
        self.blobs = blobs
        self.chunk = chunk
        self.requested = []

    def __call__(self, url):
        self.requested.append(url)
        data = self.blobs[url]
        return (data[i : i + self.chunk] for i in range(0, len(data), self.chunk))


@pytest.fixture
def packages():
    return [
        pkg("cublas", CUBLAS, dlls=("cublas64_12.dll",)),
        pkg("cudnn", CUDNN, dlls=("cudnn64_9.dll",)),
    ]


def test_install_extracts_only_listed_dlls_with_progress(tmp_path, packages):
    http = FakeHttp({p.url: b for p, b in zip(packages, (CUBLAS, CUDNN))})
    progress = []
    target = tmp_path / "cuda"

    cuda_runtime.install(target, lambda d, t: progress.append((d, t)), packages=packages, fetch=http)

    assert sorted(f.name for f in target.iterdir()) == ["cublas64_12.dll", "cudnn64_9.dll"]
    assert (target / "cublas64_12.dll").read_bytes() == b"a" * 300
    total = len(CUBLAS) + len(CUDNN)
    assert progress[-1] == (total, total)
    assert [d for d, _ in progress] == sorted(d for d, _ in progress)
    assert cuda_runtime.is_installed(target, packages)


def test_hash_mismatch_installs_nothing(tmp_path, packages):
    bad = [pkg("cublas", CUBLAS, sha="0" * 64, dlls=("cublas64_12.dll",)), packages[1]]
    http = FakeHttp({bad[0].url: CUBLAS, bad[1].url: CUDNN})
    target = tmp_path / "cuda"

    with pytest.raises(cuda_runtime.IntegrityError):
        cuda_runtime.install(target, lambda *_: None, packages=bad, fetch=http)

    assert not cuda_runtime.is_installed(target, bad)
    assert not any(target.glob("*.dll")) if target.exists() else True
    assert not list(tmp_path.rglob("*.part"))


def test_missing_dll_in_wheel_is_an_error(tmp_path):
    broken = [pkg("cublas", CUBLAS, dlls=("cublasLt64_12.dll",))]
    http = FakeHttp({broken[0].url: CUBLAS})
    with pytest.raises(cuda_runtime.IntegrityError, match="cublasLt64_12.dll"):
        cuda_runtime.install(tmp_path / "cuda", lambda *_: None, packages=broken, fetch=http)


def test_already_installed_package_is_skipped(tmp_path, packages):
    http = FakeHttp({p.url: b for p, b in zip(packages, (CUBLAS, CUDNN))})
    target = tmp_path / "cuda"
    cuda_runtime.install(target, lambda *_: None, packages=packages, fetch=http)
    http.requested.clear()

    cuda_runtime.install(target, lambda *_: None, packages=packages, fetch=http)
    assert http.requested == []


def test_pinned_packages_cover_what_ctranslate2_loads():
    names = {d for p in cuda_runtime.PACKAGES for d in p.dlls}
    assert {"cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll", "cudnn_cnn64_9.dll", "cudnn_ops64_9.dll"} <= names
    assert "cudnn_adv64_9.dll" not in names  # RNN/attention kernels, unused by Whisper; 271 MB
    for p in cuda_runtime.PACKAGES:
        assert p.url.startswith("https://files.pythonhosted.org/")
        assert len(p.sha256) == 64


def test_status(tmp_path, packages):
    assert cuda_runtime.status("cpu", [tmp_path], packages) == "not_needed"
    assert cuda_runtime.status("cuda", [tmp_path], packages, platform="win32") == "missing"
    for name in ("cublas64_12.dll", "cudnn64_9.dll"):
        (tmp_path / name).write_bytes(b"")
    assert cuda_runtime.status("cuda", [tmp_path], packages, platform="win32") == "ready"
    # Off Windows the libraries come from the system or pip; nothing to download.
    assert cuda_runtime.status("cuda", [], packages, platform="linux") == "ready"
