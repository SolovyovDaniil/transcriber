"""Dispatches protocol requests to the transcriber, job queue and model store."""

from __future__ import annotations

import dataclasses
import os
import threading
from typing import Callable

from . import cuda_runtime, formats, models, protocol
from .hardware import SystemInfo
from .jobs import Job, JobQueue, Status
from .result import Transcript
from .transcriber import Options, OptionsError, Transcriber


@dataclasses.dataclass(frozen=True)
class JobSpec:
    options: Options
    srt_path: str | None  # where to save the SRT when the job finishes


class InvalidParams(Exception):
    pass


class NotFound(Exception):
    pass


class CudaMissing(Exception):
    pass


class _NoCuda:
    """Default when no runtime manager is given: nothing to download."""

    def status(self) -> str:
        return "not_needed"

    def install(self, on_progress) -> None:
        pass


def _require(params: dict, key: str, kind: type = str):
    value = params.get(key)
    if not isinstance(value, kind):
        raise InvalidParams(f"'{key}' is required and must be {kind.__name__}")
    return value


class Server:
    def __init__(
        self,
        write: Callable[[str], None],
        system: SystemInfo,
        transcriber: Transcriber,
        store,
        version: str,
        cuda=None,
    ):
        self._write = write
        self.system = system
        self.transcriber = transcriber
        self.store = store
        self.version = version
        self.cuda = cuda or _NoCuda()
        self.jobs = JobQueue(run=self._run_job, on_status=self._job_status)
        self._downloads: list[threading.Thread] = []
        self._methods = {
            "system.info": self.system_info,
            "models.list": self.models_list,
            "models.download": self.models_download,
            "runtime.download": self.runtime_download,
            "transcribe.start": self.transcribe_start,
            "transcribe.cancel": self.transcribe_cancel,
            "export": self.export,
        }

    # --- transport ---

    def handle_line(self, line: str) -> bool:
        """Handle one request line. Returns False when the engine should stop."""
        try:
            req = protocol.parse_request(line)
        except protocol.ProtocolError as e:
            self._write(protocol.error(e.request_id, e.code, e.message))
            return True
        if req.method == "shutdown":
            self._write(protocol.response(req.id, {"ok": True}))
            return False
        handler = self._methods.get(req.method)
        if handler is None:
            self._write(protocol.error(req.id, "method_not_found", f"Unknown method: {req.method}"))
            return True
        try:
            result = handler(req.params)
        except (InvalidParams, OptionsError, ValueError, KeyError) as e:
            self._write(protocol.error(req.id, "invalid_params", str(e)))
        except NotFound as e:
            self._write(protocol.error(req.id, "not_found", str(e)))
        except CudaMissing as e:
            self._write(protocol.error(req.id, "cuda_missing", str(e)))
        except Exception as e:
            self._write(protocol.error(req.id, "internal_error", f"{type(e).__name__}: {e}"))
        else:
            self._write(protocol.response(req.id, result))
        return True

    def _emit(self, name: str, data: dict) -> None:
        self._write(protocol.event(name, data))

    def wait_jobs(self) -> None:
        self.jobs.join()

    def wait_downloads(self) -> None:
        for t in list(self._downloads):
            t.join()

    def close(self) -> None:
        self.jobs.cancel_all()
        self.jobs.close()

    # --- methods ---

    def system_info(self, params: dict) -> dict:
        vram = self.system.vram_total_mb
        recommended = models.recommend(self.system.device, vram)
        return {
            "version": self.version,
            "device": self.system.device,
            "gpus": [dataclasses.asdict(g) for g in self.system.gpus],
            "recommended_model": recommended,
            "compute_types": models.compute_chain(recommended, self.system.device, vram),
            "loaded": self.transcriber.loaded,
            "cuda_runtime": self.cuda.status(),
            "cuda_download_size": cuda_runtime.DOWNLOAD_SIZE,
        }

    def models_list(self, params: dict) -> dict:
        recommended = models.recommend(self.system.device, self.system.vram_total_mb)
        return {
            "models": [
                {
                    "name": m.name,
                    "size_mb": m.size_mb,
                    "downloaded": self.store.is_downloaded(m.name),
                    "recommended": m.name == recommended,
                }
                for m in models.CATALOG.values()
            ]
        }

    def models_download(self, params: dict) -> dict:
        name = _require(params, "model")
        models.get(name)  # KeyError -> invalid_params

        def run():
            try:
                self.store.download(
                    name,
                    lambda done, total: self._emit(
                        "model.progress", {"model": name, "downloaded": done, "total": total}
                    ),
                )
            except Exception as e:
                self._emit("model.error", {"model": name, "error": str(e)})
            else:
                self._emit("model.done", {"model": name})

        thread = threading.Thread(target=run, name=f"download-{name}", daemon=True)
        self._downloads.append(thread)
        thread.start()
        return {"started": True}

    def runtime_download(self, params: dict) -> dict:
        def run():
            try:
                self.cuda.install(
                    lambda done, total: self._emit("runtime.progress", {"downloaded": done, "total": total})
                )
            except Exception as e:
                self._emit("runtime.error", {"error": str(e) or type(e).__name__})
            else:
                self._emit("runtime.done", {})

        thread = threading.Thread(target=run, name="download-cuda", daemon=True)
        self._downloads.append(thread)
        thread.start()
        return {"started": True}

    def transcribe_start(self, params: dict) -> dict:
        path = _require(params, "path")
        options = Options.from_params(params.get("options") or {})
        srt_path = params.get("srt_path")
        if srt_path is not None and not isinstance(srt_path, str):
            raise InvalidParams("'srt_path' must be a string")
        if not os.path.isfile(path):
            raise NotFound(f"File not found: {path}")
        if self.cuda.status() == "missing":
            raise CudaMissing("CUDA libraries are not installed yet")
        job = self.jobs.submit(path, JobSpec(options, srt_path))
        return {"job_id": job.id}

    def transcribe_cancel(self, params: dict) -> dict:
        return {"cancelled": self.jobs.cancel(_require(params, "job_id"))}

    def export(self, params: dict) -> dict:
        transcript = Transcript.from_dict(_require(params, "transcript", dict))
        fmt = _require(params, "format")
        if fmt not in formats.FORMATS:
            raise InvalidParams(f"Unknown format: {fmt}")
        path = formats.write(transcript, fmt, _require(params, "path"))
        return {"path": str(path)}

    # --- jobs ---

    def _run_job(self, job: Job) -> Transcript:
        def progress(done: float, total: float) -> None:
            fraction = round(done / total, 4) if total > 0 else 1.0
            self._emit("job.progress", {"job_id": job.id, "done": done, "total": total, "fraction": fraction})

        spec: JobSpec = job.options
        transcript = self.transcriber.transcribe(
            job.path,
            spec.options,
            on_progress=progress,
            on_segment=lambda seg: self._emit("job.segment", {"job_id": job.id, "segment": seg.to_dict()}),
            on_reset=lambda ct: self._emit("job.reset", {"job_id": job.id, "compute_type": ct}),
            is_cancelled=job.cancel_requested.is_set,
        )
        if spec.srt_path:
            formats.write(transcript, "srt", spec.srt_path)  # failure marks the job as error
        return transcript

    def _job_status(self, job: Job) -> None:
        data = {"job_id": job.id, "path": job.path, "status": job.status.value}
        if job.status == Status.ERROR:
            data["error"] = job.error
        if job.status == Status.DONE:
            spec: JobSpec = job.options
            self._emit(
                "job.done",
                {"job_id": job.id, "transcript": job.result.to_dict(), "srt_path": spec.srt_path},
            )
        self._emit("job.status", data)
