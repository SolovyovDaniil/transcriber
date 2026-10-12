import json

import pytest

from transcriber_engine import formats
from transcriber_engine.result import Segment, Transcript, Word


def make_transcript(*segments: Segment) -> Transcript:
    return Transcript(language="ru", duration=10.0, segments=segments)


@pytest.mark.parametrize(
    ("seconds", "sep", "expected"),
    [
        (0, ",", "00:00:00,000"),
        (1.5, ",", "00:00:01,500"),
        (3661.007, ".", "01:01:01.007"),
        (59.9996, ",", "00:01:00,000"),  # rounding carries into the next second
        (-0.2, ",", "00:00:00,000"),  # clamp negatives
    ],
)
def test_timestamp(seconds, sep, expected):
    assert formats.timestamp(seconds, sep) == expected


def test_srt():
    t = make_transcript(
        Segment(0.0, 1.25, " Привет."),
        Segment(1.5, 3.0, " Как дела?"),
    )
    assert formats.to_srt(t) == (
        "1\n00:00:00,000 --> 00:00:01,250\nПривет.\n\n"
        "2\n00:00:01,500 --> 00:00:03,000\nКак дела?\n"
    )


def test_srt_skips_blank_segments_and_renumbers():
    t = make_transcript(
        Segment(0.0, 1.0, "  "),
        Segment(1.0, 2.0, "Текст"),
    )
    assert formats.to_srt(t) == "1\n00:00:01,000 --> 00:00:02,000\nТекст\n"


def test_vtt():
    t = make_transcript(Segment(0.0, 1.0, " Hello"))
    assert formats.to_vtt(t) == "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n"


def test_txt_plain_and_timestamped():
    t = make_transcript(Segment(0.0, 1.0, " Один."), Segment(65.0, 66.0, " Два."))
    assert formats.to_txt(t) == "Один.\nДва.\n"
    assert formats.to_txt(t, timestamps=True) == "[00:00:00] Один.\n[00:01:05] Два.\n"


def test_empty_transcript():
    t = make_transcript()
    assert formats.to_srt(t) == ""
    assert formats.to_vtt(t) == "WEBVTT\n\n"
    assert formats.to_txt(t) == ""


def test_json_roundtrip():
    t = make_transcript(Segment(0.0, 1.0, "Hi", words=(Word(0.0, 1.0, "Hi", 0.9),)))
    data = json.loads(formats.to_json(t))
    assert Transcript.from_dict(data) == t


def test_render_by_name_and_unknown():
    t = make_transcript(Segment(0.0, 1.0, "x"))
    assert formats.render(t, "srt") == formats.to_srt(t)
    with pytest.raises(ValueError):
        formats.render(t, "pdf")


def test_write_docx(tmp_path):
    docx = pytest.importorskip("docx")
    t = make_transcript(Segment(0.0, 1.0, " Абзац"))
    path = tmp_path / "out.docx"
    formats.write(t, "docx", path)
    assert [p.text for p in docx.Document(str(path)).paragraphs] == ["[00:00:00] Абзац"]


def test_write_text_format_utf8(tmp_path):
    t = make_transcript(Segment(0.0, 1.0, "Ёжик"))
    path = tmp_path / "out.srt"
    formats.write(t, "srt", path)
    assert path.read_text(encoding="utf-8") == formats.to_srt(t)
