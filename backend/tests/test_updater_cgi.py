from __future__ import annotations

import os
import stat
import subprocess


SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "updater",
    "update.cgi",
)


def _run_update_cgi(*, method: str = "POST", authorization: str = "Bearer secret", run_script: str | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["REQUEST_METHOD"] = method
    env["HTTP_AUTHORIZATION"] = authorization
    env["UPDATER_TOKEN"] = "secret"
    if run_script is not None:
        env["RUN_UPDATE_SCRIPT"] = run_script
    return subprocess.run(
        ["sh", SCRIPT_PATH],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def test_update_cgi_rejects_invalid_method():
    result = _run_update_cgi(method="GET")

    assert result.returncode == 0
    assert result.stdout.startswith("HTTP/1.1 405 Method Not Allowed\n")
    assert "Content-Type: application/json" in result.stdout
    assert '{"detail":"Method not allowed"}' in result.stdout


def test_update_cgi_starts_update_and_returns_http_status(tmp_path):
    stub_script = tmp_path / "run-update.sh"
    stub_script.write_text("#!/bin/sh\nexit 0\n", encoding="ascii")
    stub_script.chmod(stub_script.stat().st_mode | stat.S_IXUSR)

    result = _run_update_cgi(run_script=str(stub_script))

    assert result.returncode == 0
    assert result.stdout.startswith("HTTP/1.1 202 Accepted\n")
    assert "Content-Type: application/json" in result.stdout
    assert '{"message":"Update initiated"}' in result.stdout
