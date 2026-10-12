import pytest

from fakes import FakeModel, ModelLoader, fw_segment
from transcriber_engine.hardware import Gpu, SystemInfo
from transcriber_engine.result import Segment, Word
from transcriber_engine.transcriber import Cancelled, Options, OptionsError, Transcriber

RTX_4060 = SystemInfo("cuda", (Gpu("NVIDIA GeForce RTX 4060", 8188, 7400, "560.94"),))
CPU = SystemInfo("cpu", ())
OOM = RuntimeError("CUDA failed with error out of memory")


class Recorder:
    def __init__(self):
        self.progress = []
        self.segments = []
        self.resets = []

    def run(self, transcriber, options=Options(), cancelled=lambda: False):
        return transcriber.transcribe(
            "audio.mp3",
            options,
            on_progress=lambda done, total: self.progress.append((done, total)),
            on_segment=self.segments.append,
            on_reset=self.resets.append,
            is_cancelled=cancelled,
        )


def three_segments():
    return [
        fw_segment(0.0, 2.0, " Раз", words=[(0.0, 2.0, " Раз", 0.9)]),
        fw_segment(2.0, 5.0, " два"),
        fw_segment(5.0, 9.5, " три"),
    ]


def test_transcribes_with_large_v3_float16_on_4060():
    model = FakeModel(three_segments())
    loader = ModelLoader(default=model)
    rec = Recorder()

    result = rec.run(Transcriber(RTX_4060, "/models", load_model=loader))

    assert loader.loaded == [("Systran/faster-whisper-large-v3", "cuda", "float16")]
    assert result.language == "ru"
    assert result.duration == 10.0
    assert result.segments[0] == Segment(0.0, 2.0, " Раз", (Word(0.0, 2.0, " Раз", 0.9),))
    assert rec.segments == list(result.segments)
    assert rec.progress == [(2.0, 10.0), (5.0, 10.0), (9.5, 10.0), (10.0, 10.0)]


def test_passes_options_to_model():
    model = FakeModel([])
    opts = Options(language="en", task="translate", initial_prompt="Kubernetes", beam_size=3)
    Recorder().run(Transcriber(RTX_4060, "/m", load_model=ModelLoader(default=model)), opts)

    audio, kwargs = model.calls[0]
    assert audio == "audio.mp3"
    assert kwargs["language"] == "en"
    assert kwargs["task"] == "translate"
    assert kwargs["initial_prompt"] == "Kubernetes"
    assert kwargs["beam_size"] == 3
    assert kwargs["vad_filter"] is True
    assert kwargs["word_timestamps"] is True
    assert kwargs["condition_on_previous_text"] is False


def test_model_is_reused_between_jobs():
    loader = ModelLoader(default=FakeModel([]))
    t = Transcriber(RTX_4060, "/m", load_model=loader)
    Recorder().run(t)
    Recorder().run(t)
    assert len(loader.loaded) == 1


def test_switching_model_reloads():
    loader = ModelLoader(default=FakeModel([]))
    t = Transcriber(RTX_4060, "/m", load_model=loader, make_batched=lambda m: m)
    Recorder().run(t)
    Recorder().run(t, Options(model="large-v3-turbo"))
    assert [repo for repo, _, _ in loader.loaded] == [
        "Systran/faster-whisper-large-v3",
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    ]


def test_oom_on_load_falls_back_to_int8_float16():
    loader = ModelLoader(default=FakeModel(three_segments()), load_errors={"float16": OOM})
    result = Recorder().run(Transcriber(RTX_4060, "/m", load_model=loader))
    assert [ct for _, _, ct in loader.loaded] == ["float16", "int8_float16"]
    assert len(result.segments) == 3


def test_oom_mid_transcription_restarts_with_fallback_and_remembers_it():
    failing = FakeModel(three_segments(), fail_with=OOM, fail_after=1)
    good = FakeModel(three_segments())
    loader = ModelLoader(by_compute_type={"float16": failing, "int8_float16": good})
    t = Transcriber(RTX_4060, "/m", load_model=loader)
    rec = Recorder()

    result = rec.run(t)

    assert rec.resets == ["int8_float16"]
    assert len(result.segments) == 3
    Recorder().run(t)  # next job starts from the working compute type
    assert [ct for _, _, ct in loader.loaded] == ["float16", "int8_float16"]


def test_non_memory_errors_are_not_retried():
    model = FakeModel(three_segments(), fail_with=ValueError("bad audio"))
    loader = ModelLoader(default=model)
    with pytest.raises(ValueError, match="bad audio"):
        Recorder().run(Transcriber(RTX_4060, "/m", load_model=loader))
    assert len(loader.loaded) == 1


def test_all_fallbacks_exhausted_raises_last_error():
    loader = ModelLoader(load_errors={"float16": OOM, "int8_float16": OOM, "int8": OOM})
    with pytest.raises(RuntimeError, match="out of memory"):
        Recorder().run(Transcriber(RTX_4060, "/m", load_model=loader))


def test_cancel_stops_between_segments():
    seen = []
    model = FakeModel(three_segments())
    t = Transcriber(RTX_4060, "/m", load_model=ModelLoader(default=model))
    with pytest.raises(Cancelled):
        t.transcribe(
            "a.wav",
            Options(),
            on_progress=lambda *_: None,
            on_segment=seen.append,
            on_reset=lambda *_: None,
            is_cancelled=lambda: len(seen) >= 1,
        )
    assert len(seen) == 1


def test_cpu_uses_int8():
    loader = ModelLoader(default=FakeModel([]))
    Recorder().run(Transcriber(CPU, "/m", load_model=loader))
    assert loader.loaded[0][1:] == ("cpu", "int8")


def test_turbo_on_gpu_uses_batched_pipeline():
    model = FakeModel([])
    batched = FakeModel([fw_segment(0, 1, "x")])
    made = []

    def make_batched(m):
        made.append(m)
        return batched

    t = Transcriber(RTX_4060, "/m", load_model=ModelLoader(default=model), make_batched=make_batched)
    result = Recorder().run(t, Options(model="large-v3-turbo"))

    assert made == [model]
    assert batched.calls[0][1]["batch_size"] == 16
    assert model.calls == []
    assert len(result.segments) == 1


@pytest.mark.parametrize(
    "params",
    [
        {"model": "huge"},
        {"task": "summarize"},
        {"beam_size": 0},
        {"batch_size": -1},
        {"language": 5},
        {"unknown": 1},
    ],
)
def test_options_validation(params):
    with pytest.raises(OptionsError):
        Options.from_params(params)


def test_options_from_params():
    opts = Options.from_params({"model": "large-v3-turbo", "language": "ru", "vad_filter": False})
    assert opts == Options(model="large-v3-turbo", language="ru", vad_filter=False)
    assert Options.from_params({"language": "auto"}).language is None
