import os
import threading
import time
from pathlib import Path

from mobsim_worker.config import WorkerConfig
from mobsim_worker.main import supervise


def record(cfg: WorkerConfig, stop: object, index: int) -> None:
    """Stand-in worker: note its start, die once (worker 0's first start), else wait for stop."""
    out = cfg.data_dir
    starts = out / f"start-{index}"
    with starts.open("a") as f:
        f.write(f"{os.getpid()}\n")
    if index == 0 and len(starts.read_text().split()) == 1:
        os._exit(3)
    while not stop.is_set():  # type: ignore[attr-defined]
        time.sleep(0.02)


def test_runs_the_configured_number_of_processes_and_restarts_one_that_dies(tmp_path: Path) -> None:
    cfg = WorkerConfig(db_host="db", db_password="x", data_dir=tmp_path, sim_workers=3)
    stop = threading.Event()
    t = threading.Thread(target=supervise, args=(cfg, stop, record, 0.05))
    t.start()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        files = [tmp_path / f"start-{i}" for i in range(3)]
        if all(f.exists() for f in files) and len(files[0].read_text().split()) >= 2:
            break
        time.sleep(0.05)
    stop.set()
    t.join(timeout=30)
    assert not t.is_alive()
    pids = {i: (tmp_path / f"start-{i}").read_text().split() for i in range(3)}
    assert len(pids[0]) == 2 and len(pids[1]) == 1 and len(pids[2]) == 1
    assert len({p for v in pids.values() for p in v}) == 4
