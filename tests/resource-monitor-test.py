#!/usr/bin/env python3
"""Boundary tests; no generated CPU/GPU load and no administrative operations."""
import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "resource-monitor.py"
SPEC = importlib.util.spec_from_file_location("resource_monitor", PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class ResourceTests(unittest.TestCase):
    def test_normalized_all_core_cpu(self):
        self.assertEqual(module.cpu_percent([100, 100, 100, 0], [125, 125, 150, 0]), 50)

    def test_first_cpu_sample_unknown(self):
        self.assertIsNone(module.cpu_percent(None, [100, 0, 100, 0]))
        self.assertIsNone(module.cpu_percent([0, 0, 0, 0], [0, 0, 0, 0]))

    def test_invalid_gpu_is_not_zero(self):
        self.assertEqual(module.gpu_from_registry([{"PerformanceStatistics": {"Renderer Utilization %": 40}}]), (None, []))
        self.assertEqual(module.gpu_from_registry([{"PerformanceStatistics": {"Device Utilization %": 101}}]), (None, []))

    def test_gpu_uses_actual_device_maximum(self):
        percent, devices = module.gpu_from_registry([
            {"model": "A", "PerformanceStatistics": {"Device Utilization %": 0}},
            {"model": "B", "PerformanceStatistics": {"Device Utilization %": 81}},
        ])
        self.assertEqual(percent, 81)
        self.assertEqual(len(devices), 2)

    def test_80_is_pause_not_reduce(self):
        guard = module.Guard()
        self.assertEqual(guard.update(20, 70, 0)["state"], "reduced")
        result = guard.update(80, 20, 1)
        self.assertFalse(result["allowRender"])
        self.assertEqual(result["fpsLimit"], 0)

    def test_ten_seconds_strictly_below_60(self):
        guard = module.Guard()
        guard.update(20, 80, 0)
        guard.update(20, 59, 1)
        self.assertFalse(guard.update(20, 59, 10.9)["allowRender"])
        result = guard.update(20, 59, 11)
        self.assertTrue(result["allowRender"])
        self.assertEqual(result["fpsLimit"], 15)
        self.assertEqual(guard.update(20, 59, 21)["fpsLimit"], 30)

    def test_recovery_resets_at_60(self):
        guard = module.Guard()
        guard.update(80, 20, 0)
        guard.update(10, 10, 1)
        guard.update(60, 10, 8)
        guard.update(10, 10, 9)
        self.assertFalse(guard.update(10, 10, 18.9)["allowRender"])
        self.assertTrue(guard.update(10, 10, 19)["allowRender"])

    def test_unknown_and_nan_fail_closed(self):
        for value in [None, float("nan"), float("inf"), -1, True]:
            self.assertFalse(module.Guard().update(20, value, 0)["allowRender"])

    def test_stale_snapshot_fails_closed(self):
        monitor = object.__new__(module.Monitor)
        monitor.lock = module.threading.Lock()
        monitor.snapshot = {"available": True, "guard": {"allowRender": True}}
        monitor.monotonic_at = module.time.monotonic() - 10
        result = monitor.read()
        self.assertTrue(result["stale"])
        self.assertFalse(result["available"])
        self.assertFalse(result["guard"]["allowRender"])


if __name__ == "__main__":
    unittest.main()
