"""Dispatch ``matraix run -c`` through Harbor or HarborJobService.

``matraix run -c`` is the only job executor. Local recipes wrap the Harbor CLI
with Playground's launch env. A non-local sidecar ``computeFamily`` (or
``--compute-family``) uses ``HarborJobService.launch`` — the same path as
Playground / ``POST /api/harbor/jobs``.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import yaml

from matraix.launch_env import required_pythonpath_entries
from matraix.persona_job import DEFAULT_DATASET

_TERMINAL_LAUNCH_STATUSES = frozenset(
    {"completed", "completed_with_errors", "failed", "cancelled"}
)


def load_job_sidecar(config_path: Path) -> dict[str, Any]:
    sidecar = config_path.with_suffix(".meta.json")
    if not sidecar.is_file():
        return {}
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def load_job_yaml(config_path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _first_agent(job: dict[str, Any]) -> dict[str, Any]:
    agents = job.get("agents")
    if isinstance(agents, list) and agents and isinstance(agents[0], dict):
        return agents[0]
    return {}


def resolve_run_compute_family(
    *,
    cli_family: str | None,
    sidecar: dict[str, Any],
) -> str | None:
    """CLI flag, then sidecar ``computeFamily``. Do not inherit process env.

    A hand-written local YAML must stay on the Harbor wrap unless the sidecar
    or ``--compute-family`` says otherwise.
    """
    if cli_family:
        raw = cli_family.strip().lower()
        return raw or None
    sidecar_family = sidecar.get("computeFamily") or sidecar.get("compute_family")
    if sidecar_family:
        raw = str(sidecar_family).strip().lower()
        return raw or None
    return None


def launch_kwargs_from_job_config(
    config_path: Path,
    *,
    execution_plane: str | None = None,
) -> dict[str, Any]:
    """Rebuild ``HarborJobService.launch`` kwargs from a generated recipe."""
    sidecar = load_job_sidecar(config_path)
    job = load_job_yaml(config_path)
    task_path = str(sidecar.get("task") or "").strip()
    if not task_path:
        raise ValueError(
            "this job YAML has no sidecar task; re-run "
            "generate_application_job.py so .meta.json exists"
        )

    retrieval = sidecar.get("retrieval") if isinstance(sidecar.get("retrieval"), dict) else {}
    persona_pool = (
        str(retrieval.get("pool") or sidecar.get("persona_pool") or DEFAULT_DATASET).strip()
        or DEFAULT_DATASET
    )
    persona_ids = _string_list(sidecar.get("selected_persona_ids")) or _string_list(
        sidecar.get("persona_ids")
    )
    agent = _first_agent(job)
    kwargs = agent.get("kwargs") if isinstance(agent.get("kwargs"), dict) else {}
    cua_backend = (
        sidecar.get("cua_backend")
        or sidecar.get("cuaBackend")
        or kwargs.get("cua_backend")
    )
    n_concurrent = job.get("n_concurrent_trials")
    seed = sidecar.get("seed")
    sample_size = sidecar.get("sample_size")
    launch_kwargs: dict[str, Any] = {
        "task_path": task_path,
        "persona_pool": persona_pool,
        "execution_mode": str(sidecar.get("execution_mode") or "auto"),
        "execution_plane": execution_plane,
    }
    if persona_ids:
        launch_kwargs["persona_ids"] = persona_ids
    elif sample_size:
        launch_kwargs["sample_size"] = int(sample_size)
    if seed is not None:
        launch_kwargs["seed"] = int(seed)
    if agent.get("name"):
        launch_kwargs["agent_name"] = str(agent["name"])
    if agent.get("model_name"):
        launch_kwargs["persona_model"] = str(agent["model_name"])
    if n_concurrent is not None:
        launch_kwargs["n_concurrent_trials"] = max(1, int(n_concurrent))
    job_name = str(job.get("job_name") or sidecar.get("job_slug") or "").strip()
    if job_name:
        launch_kwargs["job_name"] = job_name
    if cua_backend:
        launch_kwargs["cua_backend"] = str(cua_backend)
    return launch_kwargs


def jobs_dir_from_job_config(config_path: Path, repo_root: Path) -> Path:
    job = load_job_yaml(config_path)
    raw = str(job.get("jobs_dir") or "jobs").strip() or "jobs"
    path = Path(raw)
    if path.is_absolute():
        return path
    return repo_root / path


def wait_for_harbor_job(service: object, job_name: str, *, poll_s: float = 2.0) -> dict[str, Any]:
    """Block until HarborJobService reports a terminal launch status."""
    while True:
        detail = service.get_job(job_name)  # type: ignore[attr-defined]
        if isinstance(detail, dict):
            launch = detail.get("launch")
            status = launch.get("status") if isinstance(launch, dict) else None
            if status in _TERMINAL_LAUNCH_STATUSES:
                return detail
        time.sleep(poll_s)


def ensure_playground_imports(repo_root: Path) -> None:
    for entry in reversed(required_pythonpath_entries(repo_root)):
        if entry not in sys.path:
            sys.path.insert(0, entry)


def should_dispatch_via_playground(
    *,
    config_path: Path,
    cli_family: str | None,
) -> tuple[bool, str | None]:
    sidecar = load_job_sidecar(config_path)
    family = resolve_run_compute_family(cli_family=cli_family, sidecar=sidecar)
    if family is None or family == "local":
        return False, family
    return True, family


def run_via_harbor_job_service(
    *,
    config_path: Path,
    repo_root: Path,
    compute_family: str | None,
    execution_plane: str | None,
    extra_launch_env: dict[str, str] | None = None,
) -> int:
    """Launch and wait. Return process exit code."""
    ensure_playground_imports(repo_root)
    from backend.service.harbor_job_service import HarborJobService

    if extra_launch_env:
        os.environ.update(extra_launch_env)

    sidecar = load_job_sidecar(config_path)
    family = resolve_run_compute_family(cli_family=compute_family, sidecar=sidecar)
    kwargs = launch_kwargs_from_job_config(
        config_path,
        execution_plane=execution_plane,
    )
    service = HarborJobService.from_repo(
        repo_root=repo_root,
        jobs_dir=jobs_dir_from_job_config(config_path, repo_root),
    )
    try:
        job_name = service.launch(**kwargs)
        print(
            "matraix run: HarborJobService job={} family={}".format(
                job_name, family or "local"
            ),
            file=sys.stderr,
        )
        detail = wait_for_harbor_job(service, job_name)
        launch = detail.get("launch") if isinstance(detail, dict) else None
        status = launch.get("status") if isinstance(launch, dict) else "unknown"
        error = launch.get("error") if isinstance(launch, dict) else None
        print("matraix run: status={}".format(status), file=sys.stderr)
        if error:
            print("matraix run: {}".format(error), file=sys.stderr)
        if status == "failed":
            return 1
        return 0
    finally:
        service.shutdown()
