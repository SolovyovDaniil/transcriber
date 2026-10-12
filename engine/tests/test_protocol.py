import json

import pytest

from transcriber_engine import protocol


def test_parse_request():
    req = protocol.parse_request('{"id": 7, "method": "system.info", "params": {"a": 1}}')
    assert req == protocol.Request(id=7, method="system.info", params={"a": 1})


def test_parse_request_defaults_params():
    assert protocol.parse_request('{"id": 1, "method": "x"}').params == {}


@pytest.mark.parametrize(
    ("line", "code"),
    [
        ("not json", "parse_error"),
        ("[1, 2]", "invalid_request"),
        ('{"id": 1}', "invalid_request"),
        ('{"id": 1, "method": 5}', "invalid_request"),
        ('{"id": 1, "method": "x", "params": []}', "invalid_request"),
    ],
)
def test_parse_request_errors(line, code):
    with pytest.raises(protocol.ProtocolError) as exc:
        protocol.parse_request(line)
    assert exc.value.code == code


def test_parse_error_keeps_request_id_when_available():
    with pytest.raises(protocol.ProtocolError) as exc:
        protocol.parse_request('{"id": 3, "method": "x", "params": "bad"}')
    assert exc.value.request_id == 3


def test_messages_are_single_json_lines():
    for line in (
        protocol.response(1, {"text": "многострочный\nтекст"}),
        protocol.error(2, "boom", "Ошибка"),
        protocol.event("job.done", {"job_id": "a"}),
    ):
        assert line.endswith("\n") and line.count("\n") == 1
        json.loads(line)


def test_message_shapes():
    assert json.loads(protocol.response(1, {"ok": True})) == {"id": 1, "result": {"ok": True}}
    assert json.loads(protocol.error(None, "c", "m")) == {
        "id": None,
        "error": {"code": "c", "message": "m"},
    }
    assert json.loads(protocol.event("e", {"x": 1})) == {"event": "e", "data": {"x": 1}}
