#!/usr/bin/env python3
"""Run one isolated native-compaction or observational-memory RPC trial."""

from __future__ import annotations

import argparse
import json
import math
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable


class PiRpc:
    def __init__(self, command: list[str], cwd: Path, event_log: Path, env: dict[str, str]):
        self.stderr_log = (event_log.parent / "pi-stderr.log").open("w", encoding="utf-8")
        self.process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr_log,
            env=env,
            text=True,
            bufsize=1,
        )
        self.messages: queue.Queue[dict[str, Any] | None] = queue.Queue()
        self.model_errors: list[str] = []
        self.event_log = event_log.open("w", encoding="utf-8")
        self.reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self.reader_thread.start()

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                message = {"type": "unparsed", "line": line.rstrip("\n")}
            self.event_log.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.event_log.flush()
            ended_message = message.get("message", {})
            if (
                message.get("type") == "message_end"
                and ended_message.get("role") == "assistant"
                and ended_message.get("stopReason") == "error"
            ):
                self.model_errors.append(ended_message.get("errorMessage", "assistant request failed"))
            self.messages.put(message)
        self.messages.put(None)

    def send(self, request: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise RuntimeError("Pi RPC stdin is unavailable")
        self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        self.process.stdin.flush()

    def wait_for(self, predicate: Callable[[dict[str, Any]], bool], timeout: float = 1800) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Timed out waiting for Pi RPC response")
            try:
                message = self.messages.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError(self._failure_message("Pi exited before responding"))
                continue
            if message is None:
                raise RuntimeError(self._failure_message("Pi RPC stdout closed"))
            if predicate(message):
                return message

    def request(self, request: dict[str, Any], timeout: float = 1800) -> dict[str, Any]:
        self.send(request)
        response = self.wait_for(
            lambda message: message.get("type") == "response" and message.get("id") == request["id"],
            timeout,
        )
        if response.get("success") is False:
            raise RuntimeError(f"RPC {request['type']} failed: {response.get('error', response)}")
        return response

    def prompt(self, prompt: str, request_id: str, timeout: float) -> tuple[dict[str, Any], float]:
        started = time.monotonic()
        previous_errors = len(self.model_errors)
        response = self.request({"id": request_id, "type": "prompt", "message": prompt}, timeout)
        self.wait_for(lambda message: message.get("type") == "agent_settled", timeout)
        if len(self.model_errors) > previous_errors:
            raise RuntimeError(f"Model request failed during {request_id}: {self.model_errors[-1]}")
        return response, time.monotonic() - started

    def _failure_message(self, prefix: str) -> str:
        stderr_path = Path(self.event_log.name).with_name("pi-stderr.log")
        try:
            self.stderr_log.flush()
            stderr = stderr_path.read_text(encoding="utf-8")[-4000:]
        except OSError:
            stderr = ""
        return f"{prefix}. stderr: {stderr}"

    def close(self) -> None:
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=10)
        self.reader_thread.join(timeout=5)
        self.event_log.close()
        self.stderr_log.close()


def save_worktree_artifacts(cwd: Path, run_dir: Path) -> None:
    diff = subprocess.run(["git", "diff", "--binary"], cwd=cwd, capture_output=True, check=False)
    (run_dir / "worktree.diff").write_bytes(diff.stdout)
    if diff.returncode != 0:
        (run_dir / "git-diff.stderr").write_bytes(diff.stderr)
    status = subprocess.run(["git", "status", "--short"], cwd=cwd, capture_output=True, text=True, check=False)
    (run_dir / "worktree-status.txt").write_text(status.stdout, encoding="utf-8")
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"], cwd=cwd, capture_output=True, text=True, check=False
    )
    for relative_path in untracked.stdout.splitlines():
        source = cwd / relative_path
        if source.is_file():
            destination = run_dir / "untracked" / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(source.read_bytes())


def resolve_pi_cli(override: Path | None) -> Path:
    if override:
        return override.resolve()
    install_root = Path.home() / ".pi" / "agent" / "install"
    version_file = install_root / "current-version"
    if not version_file.is_file():
        raise FileNotFoundError(f"Cannot find Pi install version file: {version_file}")
    version = version_file.read_text(encoding="utf-8").strip()
    cli = install_root / "releases" / version / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "bundle" / "cli.js"
    if not cli.is_file():
        raise FileNotFoundError(f"Cannot find Pi CLI entrypoint: {cli}")
    return cli


def read_pacing_metrics(log_dir: Path) -> dict[str, float | int]:
    main_delay_ms = worker_delay_ms = request_count = 0
    if log_dir.is_dir():
        for path in log_dir.glob("request-pacing-*.jsonl"):
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                delay = int(record.get("delayMs", 0) or 0)
                request_count += 1
                if record.get("role") == "main":
                    main_delay_ms += delay
                else:
                    worker_delay_ms += delay
    return {
        "mainDelaySeconds": main_delay_ms / 1000,
        "workerDelaySeconds": worker_delay_ms / 1000,
        "totalDelaySeconds": (main_delay_ms + worker_delay_ms) / 1000,
        "pacedRequests": request_count,
    }


def collect_worker_stats(cwd: Path, session_id: str) -> dict[str, Any]:
    agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent")).expanduser()
    session_dir = Path(os.environ.get("PI_CODING_AGENT_SESSION_DIR", agent_dir / "sessions")).expanduser()
    expected_cwd = str(cwd / ".memory" / session_id)
    sessions: list[dict[str, Any]] = []
    totals = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
    cost = 0.0
    cost_reported = False
    if not session_dir.is_dir():
        return {"sessions": sessions, "tokens": totals, "costUsd": cost, "costReported": cost_reported}

    for path in session_dir.rglob("*.jsonl"):
        try:
            with path.open(encoding="utf-8") as stream:
                header = json.loads(stream.readline())
                if header.get("type") != "session" or header.get("cwd") != expected_cwd:
                    continue
                name = ""
                usage_totals = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
                session_cost = 0.0
                session_cost_reported = False
                for line in stream:
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if entry.get("type") == "session_info":
                        name = str(entry.get("name", ""))
                    message = entry.get("message", {})
                    if entry.get("type") != "message" or message.get("role") != "assistant":
                        continue
                    usage = message.get("usage", {})
                    for key in usage_totals:
                        value = usage.get(key, 0)
                        if isinstance(value, (int, float)) and value >= 0:
                            usage_totals[key] += int(value)
                    amount = usage.get("cost", {}).get("total")
                    if isinstance(amount, (int, float)) and amount >= 0:
                        session_cost += float(amount)
                        session_cost_reported = True
                sessions.append({"file": str(path), "name": name, "tokens": usage_totals, "costUsd": session_cost, "costReported": session_cost_reported})
                for key, value in usage_totals.items():
                    totals[key] += value
                cost += session_cost
                cost_reported = cost_reported or session_cost_reported
        except (OSError, ValueError, TypeError):
            continue
    return {"sessions": sessions, "tokens": totals, "costUsd": cost, "costReported": cost_reported}


def configure_worker_models(
    cwd: Path, model_id: str, observer_thinking: str, consolidator_thinking: str, memory_diagnostics: bool = False
) -> None:
    if "/" not in model_id:
        raise ValueError("Worker model must be provider/modelId")
    provider, model = model_id.split("/", 1)
    settings_path = cwd / ".pi" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    if settings_path.exists():
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        if not isinstance(settings, dict):
            raise ValueError(f"Project settings must be a JSON object: {settings_path}")
    else:
        settings = {}
    om = settings.setdefault("observational-memory", {})
    if not isinstance(om, dict):
        raise ValueError("The observational-memory project setting must be an object")
    models = om.setdefault("models", {})
    if not isinstance(models, dict):
        raise ValueError("observational-memory.models must be an object")
    models["observer"] = {"provider": provider, "id": model, "thinking": observer_thinking}
    models["consolidator"] = {"provider": provider, "id": model, "thinking": consolidator_thinking}
    if memory_diagnostics:
        om["debugLog"] = True
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


def safe_trace_session_id(session_id: str) -> str | None:
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", session_id.strip()).strip("_")[:128]
    return sanitized if re.search(r"[A-Za-z0-9]", sanitized) else None


def memory_trace_path(session_id: str) -> Path | None:
    safe_id = safe_trace_session_id(session_id)
    if safe_id is None:
        return None
    agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent")).expanduser()
    return agent_dir / "observational-memory" / "debug" / f"{safe_id}.ndjson"


def read_memory_events(path: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if not path.is_file():
        return events
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def lifecycle_event_counts(session_id: str) -> dict[str, int]:
    path = memory_trace_path(session_id)
    if path is None:
        return {}
    counts: dict[str, int] = {}
    for event in read_memory_events(path):
        name = event.get("event")
        if isinstance(name, str):
            counts[name] = counts.get(name, 0) + 1
    return counts


def wait_for_memory_idle(session_id: str, timeout: float) -> float:
    started = time.monotonic()
    deadline = started + timeout
    while True:
        counts = lifecycle_event_counts(session_id)
        observer_active = counts.get("observer.started", 0) - counts.get("observer.completed", 0) - counts.get("observer.failed", 0)
        consolidator_active = counts.get("consolidator.started", 0) - counts.get("consolidator.completed", 0) - counts.get("consolidator.failed", 0)
        if observer_active <= 0 and consolidator_active <= 0:
            return time.monotonic() - started
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Memory workers did not become idle: {counts}")
        time.sleep(min(0.25, max(0.01, deadline - time.monotonic())))


def wait_for_consolidation(session_id: str, timeout: float) -> float:
    path = memory_trace_path(session_id)
    if path is None:
        raise RuntimeError("Cannot resolve diagnostics path for this session id")
    started = time.monotonic()
    deadline = started + timeout
    while True:
        events = read_memory_events(path)
        observers_completed = sum(event.get("event") == "observer.completed" for event in events)
        consolidators_completed = sum(event.get("event") == "consolidator.completed" for event in events)
        if observers_completed > 0 and consolidators_completed > 0:
            return time.monotonic() - started
        if time.monotonic() >= deadline:
            counts: dict[str, int] = {}
            for event in events:
                name = event.get("event")
                if isinstance(name, str):
                    counts[name] = counts.get(name, 0) + 1
            raise TimeoutError(f"Memory lifecycle did not complete before compaction: {counts}")
        time.sleep(min(0.25, max(0.01, deadline - time.monotonic())))


def collect_memory_trace(run_dir: Path, session_id: str) -> dict[str, Any]:
    source = memory_trace_path(session_id)
    if source is None:
        return {"available": False, "reason": "invalid_session_id", "eventCounts": {}}
    if not source.is_file():
        return {"available": False, "reason": "trace_file_missing", "eventCounts": {}}
    destination = run_dir / "memory-trace.ndjson"
    shutil.copy2(source, destination)
    counts: dict[str, int] = {}
    schema_versions: set[int] = set()
    for event in read_memory_events(destination):
        name = event.get("event")
        if isinstance(name, str):
            counts[name] = counts.get(name, 0) + 1
        version = event.get("schemaVersion")
        if isinstance(version, int):
            schema_versions.add(version)
    return {"available": True, "path": "memory-trace.ndjson", "eventCounts": counts, "schemaVersions": sorted(schema_versions)}


def is_session_topic_path(path_value: Any, cwd: Path, session_id: str) -> bool:
    if not isinstance(path_value, str) or not path_value.strip():
        return False
    root = (cwd / ".memory" / session_id).resolve()
    candidate = Path(path_value)
    try:
        resolved = (candidate if candidate.is_absolute() else cwd / candidate).resolve()
        if resolved == root or root not in resolved.parents or resolved.suffix != ".md":
            return False
        relative = resolved.relative_to(root)
        return ".runs" not in relative.parts
    except (OSError, RuntimeError):
        return False


def trial_usage(
    rpc: PiRpc, cwd: Path, session_id: str, condition: str, require_worker_report: bool = True
) -> dict[str, Any]:
    stats_response = rpc.request({"id": f"budget-stats-{uuid.uuid4().hex[:8]}", "type": "get_session_stats"})
    stats = stats_response.get("data", {})
    main_cost = stats.get("cost")
    if isinstance(main_cost, bool) or not isinstance(main_cost, (int, float)) or not math.isfinite(main_cost) or main_cost < 0:
        raise RuntimeError("Main-session cost is unavailable; refusing to continue under a spend cap")

    entries_response = rpc.request({"id": f"budget-entries-{uuid.uuid4().hex[:8]}", "type": "get_entries"})
    entries = entries_response.get("data", {}).get("entries", [])
    worker_cost_entries = [
        entry for entry in entries
        if entry.get("customType") == "om.cost"
        and isinstance(entry.get("data", {}).get("costUsd"), (int, float))
        and not isinstance(entry.get("data", {}).get("costUsd"), bool)
        and math.isfinite(entry.get("data", {}).get("costUsd"))
        and entry.get("data", {}).get("costUsd") >= 0
    ]
    worker_ledger_cost = sum(
        float(entry.get("data", {}).get("costUsd", 0) or 0)
        for entry in worker_cost_entries
    )
    worker_stats = collect_worker_stats(cwd, session_id) if condition == "om" else {"sessions": [], "costUsd": 0.0, "costReported": True}
    worker_cost_reported = bool(worker_cost_entries) or bool(worker_stats.get("costReported"))
    if condition == "om" and require_worker_report and not worker_cost_reported:
        raise RuntimeError("OM worker cost is unavailable; refusing to continue under a spend cap")
    worker_cost = max(worker_ledger_cost, float(worker_stats.get("costUsd", 0) or 0))
    return {
        "mainCostUsd": float(main_cost),
        "workerLedgerCostUsd": worker_ledger_cost,
        "workerSessionCostUsd": float(worker_stats.get("costUsd", 0) or 0),
        "workerCostUsd": worker_cost,
        "totalCostUsd": float(main_cost) + worker_cost,
        "mainCostReported": True,
        "workerCostReported": worker_cost_reported,
    }


def collect_topic_reads(event_log: Path, cwd: Path, session_id: str) -> list[dict[str, Any]]:
    active: dict[str, dict[str, Any]] = {}
    completed: list[dict[str, Any]] = []
    if not event_log.is_file():
        return completed
    for line in event_log.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        call_id = event.get("toolCallId")
        if event.get("type") == "tool_execution_start" and event.get("toolName") == "read":
            args = event.get("args", {})
            path_value = args.get("path") if isinstance(args, dict) else None
            if isinstance(call_id, str) and is_session_topic_path(path_value, cwd, session_id):
                active[call_id] = {"toolCallId": call_id, "path": str(path_value)}
        elif event.get("type") == "tool_execution_end" and isinstance(call_id, str) and call_id in active:
            is_error = event.get("isError")
            outcome = "failed" if is_error is True else "succeeded" if is_error is False else "unverified"
            completed.append({**active.pop(call_id), "isError": is_error if isinstance(is_error, bool) else None, "outcome": outcome})
    completed.extend({**record, "isError": None, "outcome": "incomplete", "incomplete": True} for record in active.values())
    return completed


def read_prompts(args: argparse.Namespace) -> list[str]:
    prompts = list(args.seed or [])
    if args.seed_file:
        loaded = json.loads(args.seed_file.read_text(encoding="utf-8"))
        if not isinstance(loaded, list) or not all(isinstance(item, str) for item in loaded):
            raise ValueError("--seed-file must contain a JSON array of prompt strings")
        prompts.extend(loaded)
    if not prompts:
        raise ValueError("Provide at least one --seed or --seed-file prompt")
    return prompts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--condition", choices=("native", "om"), required=True)
    parser.add_argument("--lookup-policy", choices=("unchanged", "guided", "mandatory"), default="unchanged")
    parser.add_argument("--cwd", type=Path, required=True, help="Isolated task worktree")
    parser.add_argument("--run-dir", type=Path, required=True, help="Directory for session and trial artifacts")
    parser.add_argument("--task-file", type=Path, required=True, help="Final implementation prompt")
    parser.add_argument("--seed", action="append", help="Planning/context prompt; can be repeated")
    parser.add_argument("--seed-file", type=Path, help="JSON array of planning/context prompts")
    parser.add_argument("--model", default="openai-codex/gpt-6-luna")
    parser.add_argument("--worker-model", default=None, help="Defaults to --model")
    parser.add_argument("--thinking", default="high", choices=("off", "minimal", "low", "medium", "high", "xhigh"))
    parser.add_argument("--observer-thinking", default="low", choices=("off", "minimal", "low", "medium", "high", "xhigh"))
    parser.add_argument("--consolidator-thinking", default="medium", choices=("off", "minimal", "low", "medium", "high", "xhigh"))
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--extension", type=Path, default=Path(__file__).parent / "extensions" / "observational-memory.ts")
    parser.add_argument("--pacer-extension", type=Path, default=Path(__file__).parent / "extensions" / "request-pacer.ts")
    parser.add_argument("--pi-cli", type=Path, help="Pi CLI entrypoint; defaults to the managed Pi installation")
    parser.add_argument("--request-interval-seconds", type=float, default=0)
    parser.add_argument("--memory-diagnostics", action="store_true", help="Record OM trigger/token diagnostics (adds benchmark-only ledger entries)")
    parser.add_argument("--max-cost-usd", type=float, default=None, help="Stop before the next phase once reported trial spend reaches this limit")
    parser.add_argument("--timeout", type=int, default=1800, help="Per-phase timeout in seconds")
    parser.add_argument(
        "--quota-pause-seconds", type=float, default=0,
        help="Wait after compaction to let the provider's per-minute quota window reset",
    )
    args = parser.parse_args()
    if args.max_cost_usd is not None and args.max_cost_usd <= 0:
        parser.error("--max-cost-usd must be greater than zero")
    if args.condition == "native" and args.lookup_policy != "unchanged":
        parser.error("--lookup-policy applies only to the OM condition")

    cwd = args.cwd.resolve()
    run_dir = args.run_dir.resolve()
    if not cwd.is_dir():
        parser.error(f"worktree does not exist: {cwd}")
    if not args.task_file.is_file():
        parser.error(f"task prompt does not exist: {args.task_file}")
    run_dir.mkdir(parents=True, exist_ok=True)
    session_dir = run_dir / "sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    session_id = args.session_id or f"bench-{args.condition}-{uuid.uuid4().hex[:12]}"
    task_prompt = args.task_file.read_text(encoding="utf-8")
    seeds = read_prompts(args)

    configure_worker_models(
        cwd,
        args.worker_model or args.model,
        args.observer_thinking,
        args.consolidator_thinking,
        memory_diagnostics=args.memory_diagnostics and args.condition == "om",
    )
    pacing_dir = run_dir / "request-pacing"
    pacer_extension = args.pacer_extension.resolve()
    rpc_args = [
        "--mode", "rpc", "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-context-files",
        "--session-dir", str(session_dir), "--session-id", session_id,
        "--model", args.model, "--thinking", args.thinking,
    ]
    env = os.environ.copy()
    env["PI_BENCHMARK_MEMORY_POLICY"] = args.lookup_policy
    if args.memory_diagnostics:
        env["PI_BENCHMARK_MEMORY_DIAGNOSTICS"] = "1"
    if args.request_interval_seconds > 0:
        pi_cli = resolve_pi_cli(args.pi_cli)
        wrapper = Path(__file__).parent / "pi-wrapper.mjs"
        pacing_dir.mkdir(parents=True, exist_ok=True)
        rpc_args.extend(["-e", str(pacer_extension)])
        env.update({
            "PI_BENCHMARK_REAL_PI_CLI": str(pi_cli),
            "PI_BENCHMARK_PACER_EXTENSION": str(pacer_extension),
            "PI_BENCHMARK_PACING_DIR": str(pacing_dir),
            "PI_BENCHMARK_REQUEST_INTERVAL_MS": str(round(args.request_interval_seconds * 1000)),
        })
        command = [shutil.which("node") or "node", str(wrapper), *rpc_args]
    else:
        command = ["pi", *rpc_args]
    if args.condition == "om":
        command.extend(["-e", str(args.extension.resolve())])

    rpc = PiRpc(command, cwd, run_dir / "rpc-events.jsonl", env)
    phase_times: dict[str, float] = {}
    phase_costs: dict[str, dict[str, Any]] = {}
    latest_usage: dict[str, Any] | None = None
    started = time.monotonic()

    def check_budget(phase: str, require_worker_report: bool = False) -> None:
        nonlocal latest_usage
        if args.max_cost_usd is None:
            return
        latest_usage = trial_usage(rpc, cwd, session_id, args.condition, require_worker_report=require_worker_report)
        phase_costs[phase] = latest_usage
        if latest_usage["totalCostUsd"] >= args.max_cost_usd:
            raise RuntimeError(
                f"Spend limit reached after {phase}: ${latest_usage['totalCostUsd']:.6f} >= ${args.max_cost_usd:.6f}"
            )

    try:
        for index, seed in enumerate(seeds, start=1):
            _, elapsed = rpc.prompt(seed, f"seed-{index}", args.timeout)
            phase_times[f"seed_{index}_seconds"] = elapsed
            check_budget(f"seed_{index}")

        if args.memory_diagnostics and args.condition == "om":
            phase_times["memory_lifecycle_barrier_seconds"] = wait_for_consolidation(session_id, args.timeout)
            check_budget("pre_compaction", require_worker_report=True)

        compact_started = time.monotonic()
        compact = rpc.request({"id": "benchmark-compact", "type": "compact"}, args.timeout)
        phase_times["compact_seconds"] = time.monotonic() - compact_started
        check_budget("compaction", require_worker_report=args.condition == "om")
        if not compact.get("success"):
            raise RuntimeError(f"Compaction did not complete: {compact.get('error', compact)}")

        if args.quota_pause_seconds > 0:
            pause_started = time.monotonic()
            time.sleep(args.quota_pause_seconds)
            phase_times["quota_pause_seconds"] = time.monotonic() - pause_started

        _, phase_times["implementation_seconds"] = rpc.prompt(task_prompt, "implementation", args.timeout)
        if args.memory_diagnostics and args.condition == "om":
            phase_times["final_worker_idle_seconds"] = wait_for_memory_idle(session_id, args.timeout)
        check_budget("implementation", require_worker_report=args.condition == "om")
        stats_response = rpc.request({"id": "benchmark-stats", "type": "get_session_stats"}, args.timeout)
        entries_response = rpc.request({"id": "benchmark-entries", "type": "get_entries"}, args.timeout)
        entries = entries_response.get("data", {}).get("entries", [])
        worker_cost = sum(
            float(entry.get("data", {}).get("costUsd", 0) or 0)
            for entry in entries
            if entry.get("customType") == "om.cost"
        )
        progress = [
            entry.get("data", {})
            for entry in entries
            if entry.get("customType") == "om.benchmark.progress"
        ]
        trigger_hooks = [
            entry.get("data", {})
            for entry in entries
            if entry.get("customType") == "om.benchmark.trigger-hook"
        ]
        pacing = read_pacing_metrics(pacing_dir)
        worker_stats = collect_worker_stats(cwd, session_id) if args.condition == "om" else {"sessions": [], "tokens": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "costUsd": 0.0}
        memory_trace = collect_memory_trace(run_dir, session_id) if args.memory_diagnostics and args.condition == "om" else {"available": False, "reason": "disabled", "eventCounts": {}}
        topic_reads = collect_topic_reads(run_dir / "rpc-events.jsonl", cwd, session_id)
        result = {
            "condition": args.condition,
            "lookupPolicy": args.lookup_policy,
            "model": args.model,
            "thinking": args.thinking,
            "sessionId": session_id,
            "cwd": str(cwd),
            "startedAtEpoch": time.time() - (time.monotonic() - started),
            "elapsedSeconds": time.monotonic() - started,
            "activeElapsedSeconds": time.monotonic() - started - phase_times.get("quota_pause_seconds", 0) - pacing["mainDelaySeconds"],
            "phaseSeconds": phase_times,
            "requestPacing": pacing,
            "compaction": compact.get("data", {}),
            "stats": stats_response.get("data", {}),
            "costAccounting": {"limitUsd": args.max_cost_usd, "phaseUsage": phase_costs, "finalUsage": latest_usage},
            "memoryDiagnostics": {"lifecycleTrace": memory_trace, "topicReads": topic_reads},
            "observationalMemory": {
                "workerCostUsd": worker_cost,
                "workerSessions": worker_stats["sessions"],
                "workerTokens": worker_stats["tokens"],
                "workerSessionCostUsd": worker_stats["costUsd"],
                "observationEntries": sum(1 for entry in entries if entry.get("customType") == "om.observations.recorded"),
                "costEntries": sum(1 for entry in entries if entry.get("customType") == "om.cost"),
                "triggerProgressSamples": len(progress),
                "maximumRawHistoryTokens": max((item.get("rawHistoryTokens", 0) for item in progress), default=0),
                "configuredChunkTokens": max((item.get("chunkTokens", 0) for item in progress), default=0),
                "productionTriggerHookCalls": len(trigger_hooks),
                "maximumHookRawHistoryTokens": max((item.get("rawHistoryTokens", 0) for item in trigger_hooks), default=0),
            },
        }
        (run_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2))
    except Exception as error:
        failure = {
            "condition": args.condition,
            "lookupPolicy": args.lookup_policy,
            "model": args.model,
            "sessionId": session_id,
            "elapsedSeconds": time.monotonic() - started,
            "activeElapsedSeconds": time.monotonic() - started - phase_times.get("quota_pause_seconds", 0) - read_pacing_metrics(pacing_dir)["mainDelaySeconds"],
            "phaseSeconds": phase_times,
            "phaseCostUsage": phase_costs,
            "latestCostUsage": latest_usage,
            "requestPacing": read_pacing_metrics(pacing_dir),
            "error": str(error),
        }
        (run_dir / "failure.json").write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        raise
    finally:
        rpc.close()
        save_worktree_artifacts(cwd, run_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"benchmark trial failed: {error}", file=sys.stderr)
        raise SystemExit(1)
