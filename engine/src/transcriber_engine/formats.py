"""Export a transcript to TXT, SRT, VTT, JSON and DOCX."""

from __future__ import annotations

import json
from pathlib import Path

from .result import Transcript

TEXT_FORMATS = ("txt", "txt_timestamps", "srt", "vtt", "json")
ALL_FORMATS = (*TEXT_FORMATS, "docx")


def timestamp(seconds: float, ms_sep: str = ",") -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rest = divmod(total_ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, ms = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{ms_sep}{ms:03d}"


def _short_timestamp(seconds: float) -> str:
    return timestamp(seconds)[:8]


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


def to_vtt(t: Transcript) -> str:
    blocks = [
        f"{timestamp(seg.start, '.')} --> {timestamp(seg.end, '.')}\n{text}\n"
        for seg, text in _cues(t)
    ]
    return "WEBVTT\n\n" + "\n".join(blocks)


def to_txt(t: Transcript, timestamps: bool = False) -> str:
    lines = [
        f"[{_short_timestamp(seg.start)}] {text}" if timestamps else text
        for seg, text in _cues(t)
    ]
    return "".join(line + "\n" for line in lines)


def to_json(t: Transcript) -> str:
    return json.dumps(t.to_dict(), ensure_ascii=False, indent=2)


def render(t: Transcript, fmt: str) -> str:
    renderers = {
        "txt": to_txt,
        "txt_timestamps": lambda tr: to_txt(tr, timestamps=True),
        "srt": to_srt,
        "vtt": to_vtt,
        "json": to_json,
    }
    if fmt not in renderers:
        raise ValueError(f"Unknown text format: {fmt}")
    return renderers[fmt](t)


def write(t: Transcript, fmt: str, path: str | Path) -> Path:
    path = Path(path)
    if fmt == "docx":
        _write_docx(t, path)
    else:
        path.write_text(render(t, fmt), encoding="utf-8")
    return path


def _write_docx(t: Transcript, path: Path) -> None:
    import docx  # optional dependency

    document = docx.Document()
    for seg, text in _cues(t):
        document.add_paragraph(f"[{_short_timestamp(seg.start)}] {text}")
    document.save(str(path))
