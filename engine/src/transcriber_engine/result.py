"""Engine-side transcript data, independent of faster-whisper types."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Word:
    start: float
    end: float
    word: str
    probability: float


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str
    words: tuple[Word, ...] = ()

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> Segment:
        words = tuple(Word(**w) for w in data.get("words", ()))
        return cls(start=data["start"], end=data["end"], text=data["text"], words=words)


@dataclass(frozen=True)
class Transcript:
    language: str
    duration: float
    segments: tuple[Segment, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "duration": self.duration,
            "segments": [s.to_dict() for s in self.segments],
        }

    @classmethod
    def from_dict(cls, data: dict) -> Transcript:
        return cls(
            language=data["language"],
            duration=data["duration"],
            segments=tuple(Segment.from_dict(s) for s in data["segments"]),
        )
