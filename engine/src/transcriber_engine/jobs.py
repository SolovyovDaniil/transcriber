"""Single-worker job queue: one transcription on the GPU at a time."""

from __future__ import annotations

import enum
import queue
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from .transcriber import Cancelled


class Status(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


FINISHED = (Status.DONE, Status.ERROR, Status.CANCELLED)


@dataclass
class Job:
    path: str
    options: Any
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: Status = Status.QUEUED
    result: Any = None
    error: str | None = None
    cancel_requested: threading.Event = field(default_factory=threading.Event)


class JobQueue:
    def __init__(self, run: Callable[[Job], Any], on_status: Callable[[Job], None]):
        self._run = run
        self._on_status = on_status
        self._jobs: dict[str, Job] = {}
        self._queue: queue.Queue[Job | None] = queue.Queue()
        self._lock = threading.Lock()
        self._worker = threading.Thread(target=self._loop, name="job-worker", daemon=True)
        self._worker.start()

    def submit(self, path: str, options: Any) -> Job:
        job = Job(path=path, options=options)
        with self._lock:
            self._jobs[job.id] = job
        self._on_status(job)
        self._queue.put(job)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in FINISHED:
                return False
            job.cancel_requested.set()
            if job.status != Status.QUEUED:
                return True  # running: the transcriber notices the flag between segments
            job.status = Status.CANCELLED
        self._on_status(job)
        return True

    def cancel_all(self) -> None:
        for job_id in list(self._jobs):
            self.cancel(job_id)

    def join(self) -> None:
        self._queue.join()

    def close(self, timeout: float = 5) -> None:
        self._queue.put(None)
        self._worker.join(timeout)

    def _set_status(self, job: Job, status: Status) -> None:
        with self._lock:
            job.status = status
        self._on_status(job)

    def _loop(self) -> None:
        while True:
            job = self._queue.get()
            try:
                if job is None:
                    return
                with self._lock:
                    if job.status == Status.CANCELLED:
                        continue
                    job.status = Status.RUNNING
                self._on_status(job)
                try:
                    job.result = self._run(job)
                except Cancelled:
                    self._set_status(job, Status.CANCELLED)
                except Exception as e:
                    job.error = str(e) or type(e).__name__
                    self._set_status(job, Status.ERROR)
                else:
                    self._set_status(job, Status.DONE)
            finally:
                self._queue.task_done()
