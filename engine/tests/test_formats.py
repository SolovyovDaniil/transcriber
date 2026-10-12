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


def test_txt():
    t = make_transcript(Segment(0.0, 1.0, " Один."), Segment(65.0, 66.0, " Два."))
    assert formats.to_txt(t) == "Один.\nДва.\n"


def test_empty_transcript():
    t = make_transcript()
    assert formats.to_srt(t) == ""
    assert formats.to_txt(t) == ""


def test_transcript_dict_roundtrip():
    t = make_transcript(Segment(0.0, 1.0, "Hi", words=(Word(0.0, 1.0, "Hi", 0.9),)))
    assert Transcript.from_dict(t.to_dict()) == t


def test_render_by_name_and_unknown():
    t = make_transcript(Segment(0.0, 1.0, "x"))
    assert formats.render(t, "srt") == formats.to_srt(t)
    with pytest.raises(ValueError):
        formats.render(t, "vtt")


def test_write_srt_utf8_with_bom(tmp_path):
    t = make_transcript(Segment(0.0, 1.0, "Ёжик"))
    path = tmp_path / "out.srt"
    formats.write(t, "srt", path)
    raw = path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    assert raw[3:].decode("utf-8") == formats.to_srt(t)
