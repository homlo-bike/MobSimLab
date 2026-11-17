"""Worker configuration loaded from environment variables and Docker secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

KNOWN_WEAK = ("changeme", "change-me", "password", "secret", "example", "mobsimlab", "postgres", "admin")


#: Most worker processes one container runs (each takes one run at a time and can use a CPU core).
MAX_SIM_WORKERS = 64


class ConfigError(Exception):
    """Raised when the worker must not start. The message never contains secret values."""


@dataclass(frozen=True)
class WorkerConfig:
    """Validated worker configuration.

    Attributes:
        db_host: PostgreSQL host name.
        db_port: PostgreSQL port.
        db_name: Database name.
        sim_workers: Number of worker processes that take runs at the same time.
        db_password: Password of the restricted ``mobsimlab_worker`` role.
        data_dir: Writable directory for run inputs and outputs.
    """

    db_host: str
    db_password: str
    data_dir: Path
    db_port: int = 5432
    db_name: str = "mobsimlab"
    sim_workers: int = 1


def secret_problem(name: str, value: str, min_len: int = 24) -> str | None:
    """Check that a secret is usable.

    Args:
        name: Secret name, used in the message.
        value: Secret value.
        min_len: Minimum length.

    Returns:
        A problem description, or None if the secret is acceptable.
    """
    if len(value) < min_len:
        return f"{name} is shorter than {min_len} characters"
    if any(w in value.lower() for w in KNOWN_WEAK):
        return f"{name} contains a well-known example value"
    if len(set(value)) < 10:
        return f"{name} has too little variety"
    return None


def load_config(env: dict[str, str] | None = None) -> WorkerConfig:
    """Load and validate configuration.

    Args:
        env: Environment mapping; defaults to ``os.environ``.

    Returns:
        The validated configuration.

    Raises:
        ConfigError: Listing every problem found.
    """
    env = dict(os.environ) if env is None else env
    problems: list[str] = []
    db_host = env.get("MOBSIMLAB_DB_HOST", "")
    if not db_host:
        problems.append("MOBSIMLAB_DB_HOST is not set")
    secrets_dir = Path(env.get("MOBSIMLAB_SECRETS_DIR", "/run/secrets"))
    # The worker role's own password if it has one (separate role passwords), else the one db_password.
    password = ""
    for name in ("db_worker_password", "db_password"):
        try:
            password = (secrets_dir / name).read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if password:
            break
    if not password:
        problems.append("secret db_password is missing (run deploy/scripts/init-secrets)")
    elif p := secret_problem("db_worker_password", password):
        problems.append(p)
    db_port = 5432
    try:
        db_port = int(env.get("MOBSIMLAB_DB_PORT", "5432"))
        if not 1 <= db_port <= 65535:
            raise ValueError
    except ValueError:
        problems.append("MOBSIMLAB_DB_PORT must be a port number")
    db_name = env.get("MOBSIMLAB_DB_NAME", "mobsimlab") or "mobsimlab"
    sim_workers = 1
    try:
        sim_workers = int(env.get("MOBSIMLAB_SIM_WORKERS", "1") or "1")
        if not 1 <= sim_workers <= MAX_SIM_WORKERS:
            raise ValueError
    except ValueError:
        problems.append(f"MOBSIMLAB_SIM_WORKERS must be a whole number from 1 to {MAX_SIM_WORKERS}")
    if problems:
        raise ConfigError("MobSimLab worker refuses to start:\n - " + "\n - ".join(problems))
    return WorkerConfig(
        db_host=db_host,
        db_password=password,
        data_dir=Path(env.get("MOBSIMLAB_DATA_DIR", "/data")),
        db_port=db_port,
        db_name=db_name,
        sim_workers=sim_workers,
    )
