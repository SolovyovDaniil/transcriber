"""JSON Lines protocol between the Tauri shell and the engine (see docs/TZ.md, 6.1)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


class ProtocolError(Exception):
    def __init__(self, code: str, message: str, request_id: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.request_id = request_id


@dataclass(frozen=True)
class Request:
    id: Any
    method: str
    params: dict = field(default_factory=dict)


def parse_request(line: str) -> Request:
    try:
        data = json.loads(line)
    except json.JSONDecodeError as e:
        raise ProtocolError("parse_error", f"Invalid JSON: {e}") from None
    if not isinstance(data, dict):
        raise ProtocolError("invalid_request", "Request must be a JSON object")
    request_id = data.get("id")
    method = data.get("method")
    params = data.get("params", {})
    if not isinstance(method, str):
        raise ProtocolError("invalid_request", "'method' must be a string", request_id)
    if not isinstance(params, dict):
        raise ProtocolError("invalid_request", "'params' must be an object", request_id)
    return Request(id=request_id, method=method, params=params)


def _line(payload: dict) -> str:
    # json.dumps escapes newlines inside strings, so one message is one line.
    return json.dumps(payload, ensure_ascii=False) + "\n"


def response(request_id: Any, result: Any) -> str:
    return _line({"id": request_id, "result": result})


def error(request_id: Any, code: str, message: str) -> str:
    return _line({"id": request_id, "error": {"code": code, "message": message}})


def event(name: str, data: dict) -> str:
    return _line({"event": name, "data": data})
