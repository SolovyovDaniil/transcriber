import json

import pytest

from fakes import FakeModel, ModelLoader, fw_segment
from transcriber_engine import formats
from transcriber_engine.hardware import Gpu, SystemInfo
from transcriber_engine.server import Server
from transcriber_engine.transcriber import Transcriber

RTX_4060 = SystemInfo("cuda", (Gpu("NVIDIA GeForce RTX 4060", 8188, 7400, "560.94"),))


class FakeStore:
    def __init__(self):
        self.downloaded = {"large-v3"}
        self.download_calls = []

    def is_downloaded(self, name):
        return name in self.downloaded

    def download(self, name, on_progress):
        self.download_calls.append(name)
        on_progress(50, 100)
        on_progress(100, 100)
        self.downloaded.add(name)


class Harness:
    def __init__(self, model=None):
        self.lines = []
        self.store = FakeStore()
        self.model = model or FakeModel([fw_segment(0.0, 1.0, " Привет"), fw_segment(1.0, 2.0, " мир")])
        transcriber = Transcriber(RTX_4060, "/m", load_model=ModelLoader(default=self.model))
        self.server = Server(self.lines.append, RTX_4060, transcriber, self.store, version="0.1.0")
        self._next_id = 0

    def call(self, method, params=None):
        self._next_id += 1
        self.server.handle_line(json.dumps({"id": self._next_id, "method": method, "params": params or {}}))
        return self.response(self._next_id)

    def messages(self):
        return [json.loads(line) for line in self.lines]

    def response(self, request_id):
        return next(m for m in self.messages() if m.get("id") == request_id)

    def events(self, name):
        return [m["data"] for m in self.messages() if m.get("event") == name]


@pytest.fixture
def h():
    harness = Harness()
    yield harness
    harness.server.close()


def test_system_info(h):
    result = h.call("system.info")["result"]
    assert result["device"] == "cuda"
    assert result["gpus"][0]["name"] == "NVIDIA GeForce RTX 4060"
    assert result["recommended_model"] == "large-v3"
    assert result["compute_types"] == ["float16", "int8_float16", "int8"]
    assert result["version"] == "0.1.0"


def test_models_list(h):
    models = {m["name"]: m for m in h.call("models.list")["result"]["models"]}
    assert models["large-v3"]["downloaded"] is True
    assert models["large-v3"]["recommended"] is True
    assert models["large-v3-turbo"]["downloaded"] is False


def test_models_download_emits_progress(h):
    assert h.call("models.download", {"model": "large-v3-turbo"})["result"] == {"started": True}
    h.server.wait_downloads()
    assert h.events("model.progress")[-1] == {
        "model": "large-v3-turbo",
        "downloaded": 100,
        "total": 100,
    }
    assert h.events("model.done") == [{"model": "large-v3-turbo"}]


def test_transcribe_flow(h, tmp_path):
    audio = tmp_path / "talk.mp3"
    audio.write_bytes(b"fake")

    job_id = h.call("transcribe.start", {"path": str(audio), "options": {"beam_size": 5}})["result"]["job_id"]
    h.server.wait_jobs()

    statuses = [e["status"] for e in h.events("job.status") if e["job_id"] == job_id]
    assert statuses == ["queued", "running", "done"]
    assert [e["segment"]["text"] for e in h.events("job.segment")] == [" Привет", " мир"]
    assert h.events("job.progress")[-1]["fraction"] == 1.0
    done = h.events("job.done")[0]
    assert done["job_id"] == job_id
    assert done["transcript"]["language"] == "ru"
    assert done["srt_path"] is None
    assert h.model.calls[0][1]["language"] == "ru"


def test_transcribe_job_error_is_reported(tmp_path):
    h = Harness(model=FakeModel([], fail_with=ValueError("Invalid data found when processing input")))
    audio = tmp_path / "broken.mp3"
    audio.write_bytes(b"x")
    job_id = h.call("transcribe.start", {"path": str(audio)})["result"]["job_id"]
    h.server.wait_jobs()

    last = h.events("job.status")[-1]
    assert last == {
        "job_id": job_id,
        "path": str(audio),
        "status": "error",
        "error": "Invalid data found when processing input",
    }
    h.server.close()


def test_transcribe_missing_file(h, tmp_path):
    resp = h.call("transcribe.start", {"path": str(tmp_path / "nope.mp3")})
    assert resp["error"]["code"] == "not_found"


def test_transcribe_bad_options(h, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    resp = h.call("transcribe.start", {"path": str(audio), "options": {"model": "huge"}})
    assert resp["error"]["code"] == "invalid_params"


def test_cancel_unknown_job(h):
    assert h.call("transcribe.cancel", {"job_id": "zzz"})["result"] == {"cancelled": False}


def test_export(h, tmp_path):
    transcript = {
        "language": "ru",
        "duration": 2.0,
        "segments": [{"start": 0.0, "end": 1.0, "text": "Отредактировано", "words": []}],
    }
    out = tmp_path / "out.srt"
    resp = h.call("export", {"transcript": transcript, "format": "srt", "path": str(out)})
    assert resp["result"] == {"path": str(out)}
    assert "Отредактировано" in out.read_text(encoding="utf-8")


def test_export_unknown_format(h, tmp_path):
    transcript = {"language": "ru", "duration": 0, "segments": []}
    resp = h.call("export", {"transcript": transcript, "format": "docx", "path": str(tmp_path / "x")})
    assert resp["error"]["code"] == "invalid_params"
    assert formats.FORMATS == ("srt", "txt")


def test_unknown_method_and_bad_json(h):
    assert h.call("nope")["error"]["code"] == "method_not_found"
    h.server.handle_line("{oops")
    assert h.messages()[-1]["error"]["code"] == "parse_error"


def test_missing_param(h):
    assert h.call("transcribe.start", {})["error"]["code"] == "invalid_params"


def test_shutdown(h):
    assert h.server.handle_line('{"id": 1, "method": "shutdown"}') is False
    assert h.response(1)["result"] == {"ok": True}


def test_transcribe_saves_srt_when_asked(h, tmp_path):
    audio = tmp_path / "лекция.mp4"
    audio.write_bytes(b"x")
    srt = tmp_path / "лекция.srt"
    h.call("transcribe.start", {"path": str(audio), "srt_path": str(srt)})
    h.server.wait_jobs()

    assert h.events("job.done")[0]["srt_path"] == str(srt)
    text = srt.read_text(encoding="utf-8-sig")
    assert "00:00:00,000 --> 00:00:01,000" in text and "Привет" in text


def test_transcribe_unwritable_srt_path_fails_job(h, tmp_path):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    h.call("transcribe.start", {"path": str(audio), "srt_path": str(tmp_path / "missing-dir" / "a.srt")})
    h.server.wait_jobs()

    assert h.events("job.status")[-1]["status"] == "error"
    assert h.events("job.done") == []
