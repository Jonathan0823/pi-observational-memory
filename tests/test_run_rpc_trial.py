import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "benchmarks"))
import run_rpc_trial  # noqa: E402


class RpcStub:
    def __init__(self):
        self.responses = [
            {"data": {"cost": 0.12}},
            {"data": {"entries": [{"customType": "om.cost", "data": {"costUsd": 0.03}}]}},
        ]

    def request(self, _request):
        return self.responses.pop(0)


class RunnerValidationTests(unittest.TestCase):
    def test_rejects_non_finite_and_non_positive_cost_limits(self):
        script = Path(__file__).resolve().parents[1] / "benchmarks" / "run_rpc_trial.py"
        for value in ("nan", "inf", "-inf", "0", "-1"):
            with self.subTest(value=value):
                result = subprocess.run(
                    [
                        sys.executable,
                        str(script),
                        "--condition", "native",
                        "--cwd", "/missing-worktree",
                        "--run-dir", "/tmp/om-budget-test",
                        "--task-file", "/missing-task",
                        "--seed", "seed",
                        f"--max-cost-usd={value}",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn("--max-cost-usd must be greater than zero", result.stderr)

    def test_consolidation_barrier_waits_for_all_current_workers_to_be_idle(self):
        active = [
            {"event": "observer.started"},
            {"event": "observer.completed"},
            {"event": "consolidator.started"},
            {"event": "consolidator.completed"},
            {"event": "consolidator.started"},
        ]
        idle = [*active, {"event": "consolidator.completed"}]
        trace_path = Path("/tmp/om-lifecycle-trace.ndjson")
        with patch.object(run_rpc_trial, "memory_trace_path", return_value=trace_path), patch.object(
            run_rpc_trial, "read_memory_events", side_effect=[active, idle]
        ) as read_events:
            elapsed = run_rpc_trial.wait_for_consolidation("session", 5)
        self.assertGreaterEqual(elapsed, 0)
        self.assertEqual(read_events.call_count, 2)


class TopicReadCollectionTests(unittest.TestCase):
    def test_correlates_outcomes_by_call_id_and_scopes_paths_to_active_topics(self):
        with tempfile.TemporaryDirectory(prefix="om-topic-reads-") as temp:
            root = Path(temp)
            cwd = root / "project"
            memory_root = cwd / ".memory" / "active-session"
            topic = memory_root / "auth.md"
            sibling_topic = cwd / ".memory" / "sibling-session" / "secret.md"
            scratch_topic = memory_root / ".runs" / "scratch.md"
            external_topic = root / "external.md"
            for path in (topic, sibling_topic, scratch_topic, external_topic):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("metadata fixture", encoding="utf-8")
            escape = memory_root / "escape.md"
            escape.symlink_to(external_topic)

            events = [
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "success", "args": {"path": ".memory/active-session/auth.md"}},
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "failed", "args": {"path": ".memory/active-session/auth.md"}},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "failed", "isError": True},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "success", "isError": False},
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "incomplete", "args": {"path": ".memory/active-session/auth.md"}},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "another-call", "isError": False},
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "unverified", "args": {"path": ".memory/active-session/auth.md"}},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "unverified"},
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "sibling", "args": {"path": str(sibling_topic)}},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "sibling", "isError": False},
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "scratch", "args": {"path": str(scratch_topic)}},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "scratch", "isError": False},
                {"type": "tool_execution_start", "toolName": "read", "toolCallId": "escape", "args": {"path": str(escape)}},
                {"type": "tool_execution_end", "toolName": "read", "toolCallId": "escape", "isError": False},
            ]
            event_log = root / "rpc-events.jsonl"
            event_log.write_text("\n".join(json.dumps(event) for event in events), encoding="utf-8")

            reads = run_rpc_trial.collect_topic_reads(event_log, cwd, "active-session")
            by_call = {read.get("toolCallId", read["path"]): read for read in reads}
            outcomes = [read["outcome"] for read in reads]
            self.assertEqual(outcomes.count("succeeded"), 1)
            self.assertEqual(outcomes.count("failed"), 1)
            self.assertEqual(outcomes.count("incomplete"), 1)
            self.assertEqual(outcomes.count("unverified"), 1)
            self.assertEqual(len(reads), 4)
            self.assertEqual(by_call["success"]["outcome"], "succeeded")

    def test_budget_usage_sums_main_cost_and_uses_the_larger_worker_cost_source(self):
        worker_stats = {"sessions": [{"costUsd": 0.05}], "costUsd": 0.05, "costReported": True}
        with patch.object(run_rpc_trial, "collect_worker_stats", return_value=worker_stats):
            usage = run_rpc_trial.trial_usage(RpcStub(), Path("/tmp/project"), "session", "om")
        self.assertEqual(usage["mainCostUsd"], 0.12)
        self.assertEqual(usage["workerCostUsd"], 0.05)
        self.assertAlmostEqual(usage["totalCostUsd"], 0.17)


if __name__ == "__main__":
    unittest.main()
