from transcriber_engine import store


def test_is_downloaded_uses_local_files_only(tmp_path):
    calls = []

    def download(repo, models_dir, local_only):
        calls.append((repo, local_only))
        if repo.endswith("large-v3"):
            return str(tmp_path)
        raise FileNotFoundError

    s = store.ModelStore(tmp_path, download=download, repo_size=lambda repo: 0)
    assert s.is_downloaded("large-v3") is True
    assert s.is_downloaded("small") is False
    assert calls[0] == ("Systran/faster-whisper-large-v3", True)


def test_download_reports_bytes_on_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "POLL_SECONDS", 0.01)
    folder = tmp_path / "models--Systran--faster-whisper-small" / "blobs"

    def download(repo, models_dir, local_only):
        folder.mkdir(parents=True)
        (folder / "model.bin.incomplete").write_bytes(b"x" * 600)
        import time

        time.sleep(0.05)
        (folder / "model.bin.incomplete").rename(folder / "model.bin")
        (folder / "config.json").write_bytes(b"y" * 400)

    progress = []
    s = store.ModelStore(tmp_path, download=download, repo_size=lambda repo: 1000)
    s.download("small", lambda done, total: progress.append((done, total)))

    assert (600, 1000) in progress
    assert progress[-1] == (1000, 1000)
    assert all(done <= total for done, total in progress)
