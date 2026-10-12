"""faster-whisper wrapper: model loading with OOM fallback, progress, cancellation."""

from __future__ import annotations

import dataclasses
import gc
from dataclasses import dataclass
from typing import Any, Callable

from . import models
from .hardware import SystemInfo
from .result import Segment, Transcript, Word

TASKS = ("transcribe", "translate")
TURBO_BATCH_SIZE = 16


class Cancelled(Exception):
    pass


class OptionsError(ValueError):
    pass


@dataclass(frozen=True)
class Options:
    model: str = models.DEFAULT_MODEL
    language: str | None = None  # None = auto-detect
    task: str = "transcribe"
    initial_prompt: str | None = None
    vad_filter: bool = True
    word_timestamps: bool = True
    beam_size: int = 5
    batch_size: int | None = None  # None = automatic

    @classmethod
    def from_params(cls, params: dict) -> Options:
        known = {f.name for f in dataclasses.fields(cls)}
        unknown = set(params) - known
        if unknown:
            raise OptionsError(f"Unknown options: {', '.join(sorted(unknown))}")
        params = dict(params)
        if params.get("language") == "auto":
            params["language"] = None
        opts = cls(**params)
        opts._validate()
        return opts

    def _validate(self) -> None:
        if self.model not in models.CATALOG:
            raise OptionsError(f"Unknown model: {self.model}")
        if self.task not in TASKS:
            raise OptionsError(f"Unknown task: {self.task}")
        if self.language is not None and not isinstance(self.language, str):
            raise OptionsError("language must be a string")
        if self.initial_prompt is not None and not isinstance(self.initial_prompt, str):
            raise OptionsError("initial_prompt must be a string")
        if not isinstance(self.beam_size, int) or self.beam_size < 1:
            raise OptionsError("beam_size must be a positive integer")
        if self.batch_size is not None and (not isinstance(self.batch_size, int) or self.batch_size < 1):
            raise OptionsError("batch_size must be a positive integer")


def _load_whisper(repo: str, device: str, compute_type: str, download_root: str):
    from faster_whisper import WhisperModel

    return WhisperModel(repo, device=device, compute_type=compute_type, download_root=download_root)


def _make_batched(model):
    from faster_whisper import BatchedInferencePipeline

    return BatchedInferencePipeline(model)


def is_recoverable(exc: BaseException) -> bool:
    """Errors that a lighter compute type may avoid: OOM or unsupported precision."""
    msg = str(exc).lower()
    return "out of memory" in msg or ("compute type" in msg and "support" in msg)


ProgressFn = Callable[[float, float], None]


class Transcriber:
    """Keeps at most one model in memory; 8 GB of VRAM has no room for two large ones."""

    def __init__(
        self,
        system: SystemInfo,
        models_dir: str,
        load_model: Callable[..., Any] = _load_whisper,
        make_batched: Callable[[Any], Any] = _make_batched,
    ):
        self.system = system
        self.models_dir = models_dir
        self._load_model = load_model
        self._make_batched = make_batched
        self._loaded: tuple[str, str, Any] | None = None  # (model name, compute type, model)
        self._working_compute: dict[str, str] = {}  # model name -> last compute type that worked

    @property
    def loaded(self) -> tuple[str, str] | None:
        return self._loaded[:2] if self._loaded else None

    def unload(self) -> None:
        self._loaded = None
        gc.collect()

    def _chain(self, name: str) -> list[str]:
        chain = models.compute_chain(name, self.system.device, self.system.vram_total_mb)
        known_good = self._working_compute.get(name)
        if known_good in chain:
            chain = chain[chain.index(known_good) :]
        return chain

    def _model(self, name: str, compute_type: str):
        if self._loaded and self._loaded[:2] == (name, compute_type):
            return self._loaded[2]
        self.unload()
        model = self._load_model(models.get(name).repo, self.system.device, compute_type, self.models_dir)
        self._loaded = (name, compute_type, model)
        return model

    def transcribe(
        self,
        audio: str,
        options: Options,
        on_progress: ProgressFn,
        on_segment: Callable[[Segment], None],
        on_reset: Callable[[str], None],
        is_cancelled: Callable[[], bool],
    ) -> Transcript:
        chain = self._chain(options.model)
        last_error: BaseException | None = None
        for i, compute_type in enumerate(chain):
            if i > 0:
                on_reset(compute_type)
            try:
                model = self._model(options.model, compute_type)
                result = self._run(model, audio, options, on_progress, on_segment, is_cancelled)
            except Cancelled:
                raise
            except Exception as e:
                if not is_recoverable(e):
                    raise
                self.unload()
                last_error = e
                continue
            self._working_compute[options.model] = compute_type
            return result
        assert last_error is not None
        raise last_error

    def _batch_size(self, options: Options) -> int | None:
        if options.batch_size is not None:
            return options.batch_size
        if options.model == models.FAST_MODEL and self.system.device == "cuda":
            return TURBO_BATCH_SIZE
        return None

    def _run(self, model, audio, options: Options, on_progress, on_segment, is_cancelled) -> Transcript:
        kwargs = dict(
            language=options.language,
            task=options.task,
            initial_prompt=options.initial_prompt,
            beam_size=options.beam_size,
            vad_filter=options.vad_filter,
            word_timestamps=options.word_timestamps,
            # Stops large-v3 from looping a hallucinated phrase over silence/music.
            condition_on_previous_text=False,
        )
        batch_size = self._batch_size(options)
        if batch_size:
            model = self._make_batched(model)
            kwargs["batch_size"] = batch_size
            kwargs["vad_filter"] = True  # batched pipeline chunks audio by VAD

        fw_segments, info = model.transcribe(audio, **kwargs)
        total = float(info.duration)
        done = 0.0
        segments = []
        try:
            for s in fw_segments:
                if is_cancelled():
                    raise Cancelled()
                seg = Segment(
                    start=float(s.start),
                    end=float(s.end),
                    text=s.text,
                    words=tuple(
                        Word(float(w.start), float(w.end), w.word, float(w.probability))
                        for w in (s.words or ())
                    ),
                )
                segments.append(seg)
                on_segment(seg)
                done = max(done, min(seg.end, total))
                on_progress(done, total)
        finally:
            close = getattr(fw_segments, "close", None)
            if close:
                close()
        if done < total:
            on_progress(total, total)
        return Transcript(language=info.language, duration=total, segments=tuple(segments))
