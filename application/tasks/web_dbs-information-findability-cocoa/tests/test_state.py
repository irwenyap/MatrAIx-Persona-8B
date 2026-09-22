from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

OUTPUT = Path("/app/output/dbs_information_findability.json")
USER_FEEDBACK = Path("/app/output/user_feedback.json")
START_URL = "https://www.dbs.com.sg/personal/default.page"
STEP_IDS = [
    "fixed_deposit_rates", "travel_rewards_card", "home_loans",
    "rates_and_fees", "overseas_transfer", "account_help",
    "deposit_accounts", "investing_getting_started",
]
SUBJECTIVE_SUFFIXES = (
    "_confidence", "_initial_expectation", "_friction", "_completion_rationale"
)
FORBIDDEN_MARKERS = (
    "login submitted", "logged in", "application submitted", "transaction submitted",
    "transfer submitted", "message sent", "contact request submitted",
)


def _nonempty(value: object, field: str, maximum: int = 4000) -> str:
    assert isinstance(value, str) and value.strip(), f"{field} must be non-empty"
    value = value.strip()
    assert len(value) <= maximum, f"{field} is too long"
    return value


def _integer(value: object, field: str, low: int = 0, high: int = 10000) -> int:
    assert isinstance(value, int) and not isinstance(value, bool), f"{field} must be an integer"
    assert low <= value <= high, f"{field} must be between {low} and {high}"
    return value


def _dbs_https(value: object, field: str) -> str:
    url = _nonempty(value, field, 2000)
    parsed = urlparse(url)
    assert parsed.scheme == "https", f"{field} must use HTTPS"
    host = (parsed.hostname or "").lower()
    assert host == "dbs.com.sg" or host.endswith(".dbs.com.sg"), f"{field} must be DBS-hosted"
    return url


def _load(path: Path, label: str) -> dict[str, object]:
    assert path.is_file(), f"Missing {path}"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict), f"{label} root must be an object"
    return data


def _feedback() -> dict[str, object]:
    data = _load(USER_FEEDBACK, "user_feedback.json")
    for step_id in STEP_IDS:
        _integer(data.get(f"{step_id}_confidence"), f"{step_id}_confidence", 1, 5)
        for suffix in ("_initial_expectation", "_friction", "_completion_rationale"):
            value = data.get(f"{step_id}{suffix}")
            assert isinstance(value, str), f"{step_id}{suffix} must be a string"
            assert len(value) <= 4000
    for field in ("overall_ease", "navigation_consistency", "confidence_finding_similar_information_later"):
        _integer(data.get(field), field, 1, 5)
    for field in ("recurring_friction", "confusing_labels_information_architecture"):
        value = data.get(field)
        assert isinstance(value, str) and len(value) <= 4000, f"{field} must be a string"
    return data


def _facet(key: str, label: str, role: str, kind: str, value: object) -> dict[str, object]:
    return {"key": key, "label": label, "role": role, "kind": kind, "value": value}


def _verifier_dir() -> Path:
    raw = os.environ.get("HARBOR_VERIFIER_DIR")
    path = Path(raw) if raw else Path("/logs/verifier")
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_output_exists() -> None:
    assert OUTPUT.is_file(), f"Missing {OUTPUT}"


def test_output_schema_and_emit_evaluation() -> None:
    data = _load(OUTPUT, OUTPUT.name)
    feedback = _feedback()
    assert data.get("start_url") == START_URL, f"start_url must be {START_URL}"
    _nonempty(data.get("start_title"), "start_title", 1000)
    completed_at = _nonempty(data.get("completed_at"), "completed_at", 100)
    datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
    for key in data:
        assert not key.endswith(SUBJECTIVE_SUFFIXES), f"subjective field {key} belongs in user_feedback.json"

    steps = data.get("steps")
    assert isinstance(steps, list) and len(steps) == 8, "steps must contain exactly eight records"
    assert [step.get("id") if isinstance(step, dict) else None for step in steps] == STEP_IDS, "step IDs/order are incorrect"
    navigation_sequences: list[list[object]] = []
    for index, step in enumerate(steps):
        assert isinstance(step, dict), f"steps[{index}] must be an object"
        path = step.get("navigation_path")
        assert isinstance(path, list), f"steps[{index}].navigation_path must be an array"
        sequences = [
            nav.get("sequence") if isinstance(nav, dict) else None for nav in path
        ]
        for sequence_index, sequence in enumerate(sequences):
            _integer(sequence, f"steps[{index}].navigation_path[{sequence_index}].sequence", 1)
        navigation_sequences.append(sequences)
    per_step_sequences = all(
        sequences == list(range(1, len(sequences) + 1))
        for sequences in navigation_sequences
    )
    flattened_sequences = [sequence for sequences in navigation_sequences for sequence in sequences]
    session_sequences = flattened_sequences == list(range(1, len(flattened_sequences) + 1))
    assert per_step_sequences or session_sequences, (
        "navigation sequences must be contiguous, using either per-step or session-global numbering"
    )
    total_actions = total_search = total_backtracking = found_count = 0
    contexts: list[dict[str, object]] = []
    all_evidence = json.dumps(data, ensure_ascii=False).lower()
    assert not any(marker in all_evidence for marker in FORBIDDEN_MARKERS), "artifact records a forbidden state-changing action"

    for index, step in enumerate(steps):
        assert isinstance(step, dict), f"steps[{index}] must be an object"
        prefix = f"steps[{index}]"
        found = step.get("found")
        assert isinstance(found, bool), f"{prefix}.found must be boolean"
        answer = step.get("answer")
        assert isinstance(answer, str) and len(answer) <= 6000, f"{prefix}.answer must be a string"
        if found:
            assert answer.strip(), f"{prefix}.answer must be non-empty when found"
            found_count += 1
        else:
            assert not answer.strip(), f"{prefix}.answer must be empty when not found"
        _dbs_https(step.get("final_url"), f"{prefix}.final_url")
        _nonempty(step.get("final_title"), f"{prefix}.final_title", 1000)
        actions = _integer(step.get("meaningful_action_count"), f"{prefix}.meaningful_action_count")
        path = step.get("navigation_path")
        assert isinstance(path, list), f"{prefix}.navigation_path must be an array"
        assert len(path) == actions, f"{prefix} action count must equal navigation path length"
        used_search = step.get("used_site_search")
        used_back = step.get("used_backtracking")
        assert isinstance(used_search, bool) and isinstance(used_back, bool), f"{prefix} flags must be booleans"
        details = step.get("backtracking_details")
        assert isinstance(details, str) and len(details) <= 4000, f"{prefix}.backtracking_details must be a string"
        if used_back:
            assert details.strip(), f"{prefix}.backtracking_details required when backtracking was used"
        else:
            assert not details.strip(), f"{prefix}.backtracking_details must be empty without backtracking"
        search_seen = back_seen = False
        for sequence, nav in enumerate(path, 1):
            assert isinstance(nav, dict), f"{prefix}.navigation_path[{sequence - 1}] must be an object"
            action = _nonempty(nav.get("action"), f"{prefix}.navigation_path.action", 1000)
            _dbs_https(nav.get("url"), f"{prefix}.navigation_path.url")
            _nonempty(nav.get("title"), f"{prefix}.navigation_path.title", 1000)
            lowered = action.lower()
            search_seen |= "site search" in lowered or "search result" in lowered
            back_seen |= "back" in lowered or "return" in lowered
        assert used_search == search_seen, f"{prefix}.used_site_search inconsistent with navigation actions"
        assert used_back == back_seen, f"{prefix}.used_backtracking inconsistent with navigation actions"
        total_actions += actions
        total_search += int(used_search)
        total_backtracking += int(used_back)
        contexts.append({
            "key": f"goal_component.{step['id']}", "label": step["id"].replace("_", " ").title(),
            "contextType": "goal_component", "facets": [
                _facet("component_id", "Component ID", "primary", "categorical", step["id"]),
                _facet("component_found", "Found", "score", "categorical", "yes" if found else "no"),
                _facet("meaningful_action_count", "Meaningful actions", "score", "numerical", actions),
                _facet("component_evidence", "Evidence", "evidence", "textual", answer.strip() or "Not found; navigation evidence recorded."),
            ],
        })

    totals = data.get("totals")
    assert isinstance(totals, dict), "totals must be an object"
    assert totals == {"meaningful_actions": total_actions, "steps_using_site_search": total_search, "steps_using_backtracking": total_backtracking}, "totals must be derived exactly from steps"
    ratio = found_count / len(STEP_IDS)
    contexts[:0] = [
        {"key": "task_outcome.primary", "label": "Task outcome", "contextType": "task_outcome", "facets": [
            _facet("outcome_status", "Outcome status", "primary", "categorical", "passed"),
            _facet("goal_completion_ratio", "Goal completion ratio", "score", "numerical", ratio),
            _facet("completion_evidence", "Completion evidence", "evidence", "textual", f"{found_count} of 8 information goals were found and all eight were recorded."),
        ]},
        {"key": "web_interaction.primary", "label": "Web interaction", "contextType": "web_interaction", "facets": [
            _facet("meaningful_actions", "Meaningful actions", "score", "numerical", total_actions),
            _facet("steps_using_site_search", "Steps using site search", "score", "numerical", total_search),
            _facet("steps_using_backtracking", "Steps using backtracking", "score", "numerical", total_backtracking),
        ]},
        {"key": "web_artifact.primary", "label": "Web artifact", "contextType": "web_artifact", "facets": [
            _facet("artifact_status", "Artifact status", "primary", "categorical", "valid"),
            _facet("artifact_evidence", "Artifact evidence", "evidence", "textual", "Ordered DBS navigation telemetry with current public-site provenance."),
        ]},
    ]
    contexts.extend([
        {"key": "user_feedback.primary", "label": "User feedback", "contextType": "user_feedback", "facets": [
            _facet("overall_ease", "Overall ease", "score", "numerical", feedback["overall_ease"]),
            _facet("navigation_consistency", "Navigation consistency", "score", "numerical", feedback["navigation_consistency"]),
            _facet("confidence_finding_similar_information_later", "Future confidence", "score", "numerical", feedback["confidence_finding_similar_information_later"]),
        ]},
        {"key": "experience.primary", "label": "Experience", "contextType": "experience", "facets": [
            _facet("recurring_friction", "Recurring friction", "explanation", "textual", feedback["recurring_friction"] or "None reported"),
            _facet("confusing_labels_information_architecture", "Confusing labels / IA", "explanation", "textual", feedback["confusing_labels_information_architecture"] or "None reported"),
        ]},
        {"key": "side_effects.primary", "label": "Side effects", "contextType": "side_effects", "facets": [_facet("state_changes", "State changes", "primary", "categorical", "none")]},
        {"key": "execution_profile.primary", "label": "Execution profile", "contextType": "execution_profile", "facets": [_facet("session_count", "Browser sessions", "evidence", "numerical", 1), _facet("goal_count", "Ordered goals", "evidence", "numerical", 8)]},
    ])
    payload = {"schemaVersion": "1.0", "artifactType": "matraix.trial_evaluation", "taskType": "web", "presenceCheck": {"passed": True, "requiredArtifacts": [OUTPUT.name, USER_FEEDBACK.name], "missingArtifacts": []}, "sourceArtifacts": {"taskOutput": str(OUTPUT), "userFeedback": str(USER_FEEDBACK)}, "contexts": contexts}
    (_verifier_dir() / "structured_output.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
