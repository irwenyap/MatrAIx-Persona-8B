"""Exercise setup through sandbox tools, including clear provisioning failures."""
import importlib.util
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest


spec = importlib.util.spec_from_file_location(
    "cocoa_runner", Path(__file__).resolve().parents[3] / "environment/agents/matraix/agents/installed/cocoa_runner.py"
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


@pytest.mark.parametrize("failure", [None, "chown", "write"])
def test_output_setup_uses_tool_identity(monkeypatch, failure):
    commands = []
    code_calls = []
    writes = []

    def run(command, **kwargs):
        commands.append(command)
        if failure == "chown" and command[0] == "chown":
            raise subprocess.CalledProcessError(1, command)

    def execute_code(**kwargs):
        code_calls.append(kwargs["code"])
        stdout = json.dumps([1000, 1000, 1000, 1000]) if len(code_calls) == 1 else "" if failure == "write" else "COCOA_OUTPUT_WRITABLE"
        return SimpleNamespace(data=SimpleNamespace(stdout=stdout, stderr="Permission denied"))

    sandbox = SimpleNamespace(
        file=SimpleNamespace(write_file=lambda **kwargs: writes.append(kwargs)),
        code=SimpleNamespace(execute_code=execute_code),
    )
    monkeypatch.setattr(runner.subprocess, "run", run)
    if failure:
        with pytest.raises(RuntimeError, match="Cocoa output setup failed"):
            runner.prepare_output(sandbox)
    else:
        runner.prepare_output(sandbox)
        assert ["chown", "-R", "1000:1000", "/app/output"] in commands
        assert len(writes) == 2
        assert "p.write_text" in code_calls[1] and "p.unlink" in code_calls[1]
