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


def test_updater_replacement_runs_from_detached_helper(tmp_path):
    from pathlib import Path
    scripts = tmp_path / 'bin'; scripts.mkdir()
    calls = tmp_path / 'calls'
    docker = scripts / 'docker'
    docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS"\n', encoding='ascii')
    wget = scripts / 'wget'
    wget.write_text('#!/bin/sh\nexit 1\n', encoding='ascii')
    docker.chmod(0o755); wget.chmod(0o755)
    env = {**os.environ, 'PATH': str(scripts) + ':' + os.environ['PATH'],
           'TMPDIR': str(tmp_path), 'DOCKER_CALLS': str(calls),
           'ZUKAN_COMPOSE_FILE': str(tmp_path / 'compose.yml'),
           'ZUKAN_ENV_FILE': str(tmp_path / '.env')}
    script = Path(SCRIPT_PATH).with_name('run-update.sh')
    result = subprocess.run(['sh', str(script)], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    lines = calls.read_text().splitlines()
    assert any('up -d --no-deps --force-recreate api frontend' in line for line in lines)
    assert any('run -d --rm --no-deps --entrypoint sh updater -c' in line for line in lines)
    assert not (tmp_path / 'zukan-updater.lock').exists()
