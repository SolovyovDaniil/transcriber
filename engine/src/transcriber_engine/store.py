"""Model files on disk: presence check and download with byte-level progress."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

from . import models

POLL_SECONDS = 0.5


def _hf_folder(models_dir: Path, repo: str) -> Path:
    # huggingface_hub cache layout: <cache_dir>/models--<org>--<name>/blobs/...
    return models_dir / ("models--" + repo.replace("/", "--"))


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink())


def _repo_size(repo: str) -> int:
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo, files_metadata=True)
    return sum(s.size or 0 for s in info.siblings or ())


def _download(repo: str, models_dir: str, local_files_only: bool) -> str:
    from faster_whisper.utils import download_model

    return download_model(repo, cache_dir=models_dir, local_files_only=local_files_only)


class ModelStore:
    def __init__(
        self,
        models_dir: str | Path,
        download: Callable[[str, str, bool], str] = _download,
        repo_size: Callable[[str], int] = _repo_size,
    ):
        self.models_dir = Path(models_dir)
        self._download = download
        self._repo_size = repo_size

    def is_downloaded(self, name: str) -> bool:
        try:
            self._download(models.get(name).repo, str(self.models_dir), True)
            return True
        except Exception:
            return False

    def download(self, name: str, on_progress: Callable[[int, int], None]) -> None:
        """Blocking download; reports (bytes on disk, total bytes) while it runs."""
        repo = models.get(name).repo
        self.models_dir.mkdir(parents=True, exist_ok=True)
        try:
            total = self._repo_size(repo)
        except Exception:
            total = models.get(name).size_mb * 1024 * 1024
        folder = _hf_folder(self.models_dir, repo)

        finished = threading.Event()

        def poll():
            while not finished.wait(POLL_SECONDS):
                on_progress(min(_dir_size(folder), total), total)

        poller = threading.Thread(target=poll, name="download-progress", daemon=True)
        poller.start()
        try:
            self._download(repo, str(self.models_dir), False)
        finally:
            finished.set()
            poller.join()
        on_progress(total, total)
