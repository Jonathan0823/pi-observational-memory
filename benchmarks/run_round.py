#!/usr/bin/env python3
"""Run an isolated native/current-OM/improved-OM benchmark round sequentially.

This orchestrates the fixed task snapshots and seed prompts used by measured
round 1. It does not start until explicitly invoked; trials may incur model
costs. Each trial gets a fresh worktree at its task's recorded start commit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BENCHMARKS = ROOT / "benchmarks"
ROUND1_MANIFEST = BENCHMARKS / "results" / "measured-round1" / "manifest.json"
DEFAULT_CURRENT_OM_COMMIT = "0b52f5eddd1b9188df5820f1560a4628d6f4bd83"
CONDITIONS = ("native", "current-om", "improved-om")


def git(*args: str, cwd: Path = ROOT, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True, check=False)
    if check and result.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New output directory; existing contents are never overwritten")
    parser.add_argument("-n", "--repetitions", type=int, default=3, help="Measured repetitions per cell (0 runs only the shakedown; default: 3)")
    parser.add_argument("--current-om-commit", default=DEFAULT_CURRENT_OM_COMMIT, help="Git commit containing current OM extension code")
    parser.add_argument("--improved-extension", type=Path, default=BENCHMARKS / "extensions" / "observational-memory.ts", help="Improved OM extension source (default: this checkout)")
    parser.add_argument("--rpc-runner", type=Path, default=BENCHMARKS / "run_rpc_trial.py")
    parser.add_argument("--pi-cli", type=Path, help="Optional Pi CLI entrypoint forwarded to run_rpc_trial.py")
    parser.add_argument("--model", default=None, help="Override model recorded in the round-1 manifest")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--task", action="append", choices=("cost-ledger", "session-scope", "worker-cwd"), help="Run one task cell; repeatable")
    parser.add_argument("--condition", action="append", choices=CONDITIONS, help="Run one condition cell; repeatable")
    parser.add_argument("--memory-diagnostics", action="store_true", help="Add diagnostic trigger telemetry (use for shakedowns only)")
    args = parser.parse_args()

    if args.repetitions < 0:
        parser.error("--repetitions cannot be negative")
    output = args.output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("--output must be outside the repository so worktrees cannot contaminate task snapshots")
    if output.exists() and any(output.iterdir()):
        parser.error(f"output directory is not empty (refusing to overwrite): {output}")

    reference: dict[str, Any] = json.loads(ROUND1_MANIFEST.read_text(encoding="utf-8"))
    tasks: dict[str, Any] = reference["tasks"]
    model = args.model or reference["model"]
    improved_extension = args.improved_extension.expanduser().resolve()
    rpc_runner = args.rpc_runner.expanduser().resolve()
    if not rpc_runner.is_file():
        parser.error(f"RPC runner does not exist: {rpc_runner}")
    if not improved_extension.is_file():
        parser.error(f"improved OM extension does not exist: {improved_extension}")
    # Resolve and validate the requested current-OM commit before creating output.
    current_commit = git("rev-parse", "--verify", f"{args.current_om_commit}^{{commit}}")
    current_extension_content = subprocess.run(
        ["git", "show", f"{current_commit}:benchmarks/extensions/observational-memory.ts"],
        cwd=ROOT, capture_output=True, check=False,
    )
    if current_extension_content.returncode:
        parser.error("current-OM commit does not contain benchmarks/extensions/observational-memory.ts")

    selected_tasks = {name: task for name, task in tasks.items() if not args.task or name in args.task}
    selected_conditions = tuple(condition for condition in CONDITIONS if not args.condition or condition in args.condition)
    trial_count = args.repetitions + 1
    output.mkdir(parents=True, exist_ok=True)
    source_dir = output / "sources"
    source_dir.mkdir()
    current_source_root = source_dir / "current-om-root"
    git("worktree", "add", "--detach", str(current_source_root), current_commit)
    # Resolve imports and runtime dependencies exactly as they do from a checkout.
    (current_source_root / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
    current_extension = current_source_root / "benchmarks" / "extensions" / "observational-memory.ts"
    improved_digest = sha256(improved_extension)
    entries: list[dict[str, Any]] = []
    for task_name, task in selected_tasks.items():
        seed_file = BENCHMARKS / "tasks" / "seeds" / f"{task_name}.json"
        task_file = BENCHMARKS / "tasks" / f"{task_name}-implementation.md"
        if not seed_file.is_file() or sha256(seed_file) != task["seedSha256"]:
            parser.error(f"seed file missing or hash mismatch for {task_name}: {seed_file}")
        if not task_file.is_file():
            parser.error(f"implementation prompt missing for {task_name}: {task_file}")
        for condition in selected_conditions:
            for repetition in range(1, trial_count + 1):
                kind = "shakedown" if repetition == 1 else "measured"
                trial_id = f"{task_name}-{condition}-{kind}" if kind == "shakedown" else f"{task_name}-{condition}-r{repetition - 1}"
                extension = None
                extension_digest = None
                source_commit = None
                if condition == "current-om":
                    extension = current_extension
                    extension_digest = sha256(current_extension)
                    source_commit = current_commit
                elif condition == "improved-om":
                    extension = improved_extension
                    extension_digest = improved_digest
                    source_commit = git("rev-parse", "HEAD") if improved_extension.is_relative_to(ROOT) else None
                entries.append({
                    "id": trial_id, "task": task_name, "condition": condition,
                    "kind": kind, "repetition": repetition if kind == "shakedown" else repetition - 1,
                    "taskStartCommit": task["startCommit"], "omSourceCommit": source_commit,
                    "extensionPath": str(extension) if extension else None,
                    "extensionSha256": extension_digest,
                    "status": "pending", "startedAt": None, "finishedAt": None,
                    "exitCode": None, "error": None,
                })

    install_root = Path.home() / ".pi" / "agent" / "install"
    version_file = install_root / "current-version"
    managed_pi_version = version_file.read_text(encoding="utf-8").strip() if version_file.is_file() else None
    om_settings = {
        "chunkTokens": 60000,
        "chunkOverlapTokens": 0,
        "poolTargetTokens": 10000,
        "consolidateAtPoolTokens": 20000,
        "compactAtContextTokens": 81000,
        "tailTokens": 20000,
        "journeyTargetTokens": 1000,
        "observerConcurrency": 4,
    }
    benchmark_settings = {
        "mainThinking": "high",
        "observerThinking": "low",
        "consolidatorThinking": "medium",
        "workerModel": model,
        **om_settings,
        "requestPacingSeconds": 0,
    }
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "running", "model": model,
        "settings": {**benchmark_settings, "shakedownsPerCell": 1,
                      "measuredRepetitionsPerCell": args.repetitions, "execution": "sequential",
                      "memoryDiagnostics": args.memory_diagnostics,
                      "dependencyPreparation": "npm ci before each trial; setup excluded from trial latency"},
        "piVersion": managed_pi_version,
        "currentOmCommit": current_commit,
        "improvedExtension": {"path": str(improved_extension), "sha256": improved_digest,
                              "sourceCommit": git("rev-parse", "HEAD") if improved_extension.is_relative_to(ROOT) else None},
        "taskSourceManifest": str(ROUND1_MANIFEST),
        "trials": entries,
    }
    manifest_path = output / "manifest.json"

    def save_manifest() -> None:
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    save_manifest()
    failures = 0
    try:
        for trial in entries:
            trial_dir = output / "trials" / trial["id"]
            worktree = output / "worktrees" / trial["id"]
            trial_dir.mkdir(parents=True)
            worktree.parent.mkdir(parents=True, exist_ok=True)
            trial["artifactDirectory"] = str(trial_dir)
            trial["worktree"] = str(worktree)
            trial["status"] = "running"
            trial["startedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            save_manifest()
            try:
                git("worktree", "add", "--detach", str(worktree), trial["taskStartCommit"])
                lockfile = worktree / "package-lock.json"
                if lockfile.is_file():
                    setup_started = time.monotonic()
                    install = subprocess.run(["npm", "ci"], cwd=worktree, text=True, capture_output=True, check=False)
                    (trial_dir / "dependency-setup.log").write_text(
                        f"command: npm ci\nexitCode: {install.returncode}\nelapsedSeconds: {time.monotonic() - setup_started:.3f}\n\n{install.stdout}\n{install.stderr}",
                        encoding="utf-8",
                    )
                    if install.returncode:
                        raise RuntimeError(f"npm ci failed with status {install.returncode}; see dependency-setup.log")
                settings_path = worktree / ".pi" / "settings.json"
                settings_path.parent.mkdir(parents=True, exist_ok=True)
                existing_settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
                existing_settings["observational-memory"] = {
                    **om_settings,
                    "passive": False,
                    "debugLog": False,
                }
                settings_path.write_text(json.dumps(existing_settings, indent=2) + "\n", encoding="utf-8")
                command = [
                    sys.executable, str(rpc_runner),
                    "--condition", "native" if trial["condition"] == "native" else "om",
                    "--cwd", str(worktree), "--run-dir", str(trial_dir),
                    "--task-file", str(BENCHMARKS / "tasks" / f"{trial['task']}-implementation.md"),
                    "--seed-file", str(BENCHMARKS / "tasks" / "seeds" / f"{trial['task']}.json"),
                    "--model", model, "--timeout", str(args.timeout),
                ]
                if trial["extensionPath"]:
                    command.extend(["--extension", trial["extensionPath"]])
                if args.pi_cli:
                    command.extend(["--pi-cli", str(args.pi_cli.expanduser().resolve())])
                if args.memory_diagnostics:
                    command.append("--memory-diagnostics")
                result = subprocess.run(command, cwd=ROOT, check=False)
                trial["exitCode"] = result.returncode
                trial["status"] = "succeeded" if result.returncode == 0 else "failed"
                if result.returncode:
                    failures += 1
                    trial["error"] = f"run_rpc_trial.py exited with status {result.returncode}"
            except Exception as error:
                trial["status"] = "failed"
                trial["error"] = str(error)
                failures += 1
            finally:
                if worktree.exists():
                    removed = subprocess.run(["git", "worktree", "remove", "--force", str(worktree)], cwd=ROOT, text=True, capture_output=True, check=False)
                    trial["worktreeCleanupError"] = removed.stderr.strip() if removed.returncode else None
                    trial["worktree"] = None
                trial["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                save_manifest()
    finally:
        source_snapshot = source_dir / "current-observational-memory.ts"
        source_snapshot.write_bytes(current_extension.read_bytes())
        for trial in entries:
            if trial["condition"] == "current-om":
                trial["extensionPath"] = "sources/current-observational-memory.ts"
        if current_source_root.exists():
            subprocess.run(["git", "worktree", "remove", "--force", str(current_source_root)], cwd=ROOT, text=True, capture_output=True, check=False)
        complete = all(trial["status"] == "succeeded" for trial in entries)
        manifest["status"] = "succeeded" if complete and not failures else "failed"
        manifest["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save_manifest()
    print(f"Round {manifest['status']}: {len(entries)} trials; manifest: {manifest_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
