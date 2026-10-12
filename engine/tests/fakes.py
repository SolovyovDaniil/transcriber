"""Stand-ins for faster-whisper objects so tests run without a GPU or model download."""

from types import SimpleNamespace


def fw_segment(start, end, text, words=()):
    return SimpleNamespace(
        start=start,
        end=end,
        text=text,
        words=[SimpleNamespace(start=s, end=e, word=w, probability=p) for s, e, w, p in words]
        or None,
    )


class FakeModel:
    """Mimics WhisperModel.transcribe: lazy segment generator + info."""

    def __init__(self, segments, duration=10.0, language="ru", fail_with=None, fail_after=0):
        self.segments = segments
        self.duration = duration
        self.language = language
        self.fail_with = fail_with
        self.fail_after = fail_after
        self.calls = []

    def transcribe(self, audio, **kwargs):
        self.calls.append((audio, kwargs))
        info = SimpleNamespace(language=self.language, language_probability=0.99, duration=self.duration)

        def gen():
            for i, seg in enumerate(self.segments):
                if self.fail_with is not None and i == self.fail_after:
                    raise self.fail_with
                yield seg
            if self.fail_with is not None and self.fail_after >= len(self.segments):
                raise self.fail_with

        return gen(), info


class ModelLoader:
    """load_model(repo, device, compute_type, download_root) that hands out prepared fakes."""

    def __init__(self, by_compute_type=None, default=None, load_errors=None):
        self.by_compute_type = by_compute_type or {}
        self.default = default
        self.load_errors = load_errors or {}
        self.loaded = []

    def __call__(self, repo, device, compute_type, download_root):
        self.loaded.append((repo, device, compute_type))
        if compute_type in self.load_errors:
            raise self.load_errors[compute_type]
        return self.by_compute_type.get(compute_type, self.default)
