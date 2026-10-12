import threading

from transcriber_engine.jobs import Job, JobQueue, Status
from transcriber_engine.transcriber import Cancelled


class StatusLog:
    def __init__(self):
        self.lock = threading.Lock()
        self.entries = []

    def __call__(self, job: Job):
        with self.lock:
            self.entries.append((job.path, job.status))

    def for_path(self, path):
        return [s for p, s in self.entries if p == path]


def test_runs_jobs_in_fifo_order():
    order = []
    log = StatusLog()
    q = JobQueue(run=lambda job: order.append(job.path) or f"result:{job.path}", on_status=log)
    jobs = [q.submit(p, None) for p in ("a", "b", "c")]
    q.join()

    assert order == ["a", "b", "c"]
    assert [j.status for j in jobs] == [Status.DONE] * 3
    assert jobs[0].result == "result:a"
    assert log.for_path("a") == [Status.QUEUED, Status.RUNNING, Status.DONE]
    assert len({j.id for j in jobs}) == 3
    q.close()


def test_error_in_one_job_does_not_stop_queue():
    def run(job):
        if job.path == "bad":
            raise ValueError("cannot decode")
        return "ok"

    q = JobQueue(run=run, on_status=lambda job: None)
    bad, good = q.submit("bad", None), q.submit("good", None)
    q.join()

    assert bad.status == Status.ERROR
    assert bad.error == "cannot decode"
    assert good.status == Status.DONE
    q.close()


def test_cancel_queued_job_never_runs():
    gate = threading.Event()
    ran = []

    def run(job):
        ran.append(job.path)
        gate.wait(5)

    log = StatusLog()
    q = JobQueue(run=run, on_status=log)
    first, second = q.submit("first", None), q.submit("second", None)

    assert q.cancel(second.id) is True
    gate.set()
    q.join()

    assert ran == ["first"]
    assert second.status == Status.CANCELLED
    assert log.for_path("second") == [Status.QUEUED, Status.CANCELLED]
    q.close()


def test_cancel_running_job_sets_flag():
    started = threading.Event()

    def run(job):
        started.set()
        assert job.cancel_requested.wait(5)
        raise Cancelled()

    q = JobQueue(run=run, on_status=lambda job: None)
    job = q.submit("x", None)
    started.wait(5)
    assert q.cancel(job.id) is True
    q.join()

    assert job.status == Status.CANCELLED
    q.close()


def test_cancel_unknown_or_finished_job():
    q = JobQueue(run=lambda job: None, on_status=lambda job: None)
    job = q.submit("x", None)
    q.join()
    assert q.cancel(job.id) is False
    assert q.cancel("nope") is False
    q.close()
