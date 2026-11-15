from pathlib import Path

import pytest

from mobsim_worker.config import ConfigError, load_config, secret_problem

STRONG = "Zx9!kQ2#vB7@mN4$pL6%tR8^yW3&cF5*"


def test_loads_valid_config(tmp_path: Path) -> None:
    (tmp_path / "db_worker_password").write_text(STRONG + "\n")
    cfg = load_config({"MOBSIMLAB_DB_HOST": "postgres", "MOBSIMLAB_SECRETS_DIR": str(tmp_path)})
    assert cfg.db_password == STRONG
    assert cfg.db_host == "postgres"


def test_refuses_missing_secret_and_host(tmp_path: Path) -> None:
    with pytest.raises(ConfigError) as e:
        load_config({"MOBSIMLAB_SECRETS_DIR": str(tmp_path)})
    assert "MOBSIMLAB_DB_HOST" in str(e.value)
    assert "db_worker_password is missing" in str(e.value)


@pytest.mark.parametrize("value", ["short", "changeme-changeme-changeme", "a" * 40])
def test_rejects_weak_secrets(value: str) -> None:
    assert secret_problem("x", value) is not None


def test_reads_port_and_name(tmp_path: Path) -> None:
    (tmp_path / "db_worker_password").write_text(STRONG)
    env = {"MOBSIMLAB_DB_HOST": "db", "MOBSIMLAB_SECRETS_DIR": str(tmp_path)}
    cfg = load_config({**env, "MOBSIMLAB_DB_PORT": "6543", "MOBSIMLAB_DB_NAME": "other"})
    assert (cfg.db_port, cfg.db_name) == (6543, "other")
    assert load_config(env).db_port == 5432
    with pytest.raises(ConfigError) as e:
        load_config({**env, "MOBSIMLAB_DB_PORT": "nope"})
    assert "MOBSIMLAB_DB_PORT" in str(e.value)
