from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

import test_state as verifier


def artifact(found: bool = True) -> dict:
    steps = []
    for sid in verifier.STEP_IDS:
        steps.append({
            "id": sid, "found": found, "answer": "Current public DBS information" if found else "",
            "final_url": "https://www.dbs.com.sg/personal/example.page", "final_title": "DBS",
            "navigation_path": [{"sequence": 1, "action": "Follow visible DBS link", "url": "https://www.dbs.com.sg/personal/example.page", "title": "DBS"}],
            "meaningful_action_count": 1, "used_site_search": False,
            "used_backtracking": False, "backtracking_details": "",
        })
    return {"start_url": verifier.START_URL, "start_title": "DBS Personal Banking", "completed_at": "2026-01-01T00:00:00Z", "steps": steps, "totals": {"meaningful_actions": 8, "steps_using_site_search": 0, "steps_using_backtracking": 0}}


def feedback() -> dict:
    data = {}
    for sid in verifier.STEP_IDS:
        data[f"{sid}_confidence"] = 3
        data[f"{sid}_initial_expectation"] = "Main navigation"
        data[f"{sid}_friction"] = ""
        data[f"{sid}_completion_rationale"] = "Evidence was present"
    data.update({"overall_ease": 3, "navigation_consistency": 3, "recurring_friction": "", "confusing_labels_information_architecture": "", "confidence_finding_similar_information_later": 3})
    return data


def run(monkeypatch, tmp_path: Path, data: dict, user_feedback: dict | None = None) -> None:
    output = tmp_path / "dbs_information_findability.json"
    report = tmp_path / "user_feedback.json"
    output.write_text(json.dumps(data), encoding="utf-8")
    if user_feedback is not None:
        report.write_text(json.dumps(user_feedback), encoding="utf-8")
    monkeypatch.setattr(verifier, "OUTPUT", output)
    monkeypatch.setattr(verifier, "USER_FEEDBACK", report)
    monkeypatch.setenv("HARBOR_VERIFIER_DIR", str(tmp_path / "verifier"))
    verifier.test_output_schema_and_emit_evaluation()


def test_complete_fixture(monkeypatch, tmp_path):
    run(monkeypatch, tmp_path, artifact(), feedback())


def test_session_global_navigation_sequence_is_accepted(monkeypatch, tmp_path):
    data = artifact()
    for sequence, step in enumerate(data["steps"], 1):
        step["navigation_path"][0]["sequence"] = sequence
    run(monkeypatch, tmp_path, data, feedback())


def test_partially_found_fixture(monkeypatch, tmp_path):
    data = artifact()
    data["steps"][2]["found"] = False
    data["steps"][2]["answer"] = ""
    run(monkeypatch, tmp_path, data, feedback())


@pytest.mark.parametrize("mutation", ["malformed", "reordered", "non_dbs", "telemetry", "forbidden"])
def test_invalid_fixtures_are_rejected(monkeypatch, tmp_path, mutation):
    data = artifact()
    if mutation == "malformed":
        data["steps"][0]["found"] = "yes"
    elif mutation == "reordered":
        data["steps"][0], data["steps"][1] = data["steps"][1], data["steps"][0]
    elif mutation == "non_dbs":
        data["steps"][0]["final_url"] = "https://example.com/"
    elif mutation == "telemetry":
        data["steps"][0]["meaningful_action_count"] = 2
    else:
        data["steps"][0]["navigation_path"][0]["action"] = "Login submitted"
    with pytest.raises(AssertionError):
        run(monkeypatch, tmp_path, data, feedback())


def test_missing_self_report_is_rejected(monkeypatch, tmp_path):
    with pytest.raises(AssertionError):
        run(monkeypatch, tmp_path, artifact(), None)


@pytest.mark.parametrize("sequences", [
    [1, 3, 3, 4, 5, 6, 7, 8],
    [1, 2, 2, 4, 5, 6, 7, 8],
    [1, 2, 4, 3, 5, 6, 7, 8],
])
def test_invalid_session_navigation_sequences_are_rejected(monkeypatch, tmp_path, sequences):
    data = artifact()
    for sequence, step in zip(sequences, data["steps"]):
        step["navigation_path"][0]["sequence"] = sequence
    with pytest.raises(AssertionError, match="navigation sequences must be contiguous"):
        run(monkeypatch, tmp_path, data, feedback())


def test_boolean_navigation_sequence_is_rejected(monkeypatch, tmp_path):
    data = artifact()
    data["steps"][0]["navigation_path"][0]["sequence"] = True
    with pytest.raises(AssertionError, match="must be an integer"):
        run(monkeypatch, tmp_path, data, feedback())
