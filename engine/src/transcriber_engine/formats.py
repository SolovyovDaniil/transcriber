"""Export a transcript to SRT (the main output) or plain TXT."""

from __future__ import annotations

from pathlib import Path

from .result import Transcript

FORMATS = ("srt", "txt")


def timestamp(seconds: float, ms_sep: str = ",") -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rest = divmod(total_ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, ms = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{ms_sep}{ms:03d}"


def _cues(t: Transcript):
    """Segments with non-blank text, stripped."""
    for seg in t.segments:
        text = seg.text.strip()
        if text:
            yield seg, text


def to_srt(t: Transcript) -> str:
    blocks = [
        f"{i}\n{timestamp(seg.start)} --> {timestamp(seg.end)}\n{text}\n"
        for i, (seg, text) in enumerate(_cues(t), start=1)
    ]
    return "\n".join(blocks)


def to_txt(t: Transcript) -> str:
    return "".join(text + "\n" for _, text in _cues(t))


def render(t: Transcript, fmt: str) -> str:
    if fmt == "srt":
        return to_srt(t)
    if fmt == "txt":
        return to_txt(t)
    raise ValueError(f"Unknown format: {fmt}")


def write(t: Transcript, fmt: str, path: str | Path) -> Path:
    path = Path(path)
    # utf-8-sig: Windows players and editors (MPC-HC, old Notepad) detect UTF-8 by the BOM.
    path.write_text(render(t, fmt), encoding="utf-8-sig")
    return path
