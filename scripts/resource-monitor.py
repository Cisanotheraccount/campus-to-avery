#!/usr/bin/env python3
"""Read-only, localhost resource monitor for the Campus to Avery viewer.

No third-party Python packages, admin access, signals, or process modification.
The renderer must enforce guard.allowRender and fail closed when this API fails.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import datetime as dt
import json
import math
import pathlib
import plistlib
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CPU_SOURCE = "macOS Mach host_statistics(HOST_CPU_LOAD_INFO), all CPU tick deltas"
GPU_SOURCE = "macOS IORegistry IOAccelerator PerformanceStatistics / Device Utilization %"
THRESHOLDS = {"reduceAt": 70, "pauseAt": 80, "resumeBelow": 60, "resumeAfterSeconds": 10}
STALE_SECONDS = 2.5
ALLOWED_ORIGINS = {"http://127.0.0.1:4184", "http://localhost:4184"}


def valid_percent(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100


def cpu_percent(previous, current):
    """Aggregate CPU load already normalizes all cores to 0..100, not N*100."""
    if previous is None or len(previous) != 4 or len(current) != 4:
        return None
    delta = [(now - before) % (2**32) for before, now in zip(previous, current)]
    total = sum(delta)
    if not total:
        return None
    return round(100 * (total - delta[2]) / total, 2)


def gpu_from_registry(registry):
    """Only use the driver's explicit device percentage; never infer from FPS."""
    devices = []
    nodes = registry if isinstance(registry, list) else []
    for device in nodes:
        if not isinstance(device, dict):
            continue
        stats = device.get("PerformanceStatistics", {})
        value = stats.get("Device Utilization %") if isinstance(stats, dict) else None
        if valid_percent(value):
            devices.append({
                "name": str(device.get("model", device.get("IOClass", "GPU"))),
                "deviceUtilizationPercent": float(value),
            })
    if not devices:
        return None, []
    # This Mac has one GPU. On multi-device systems take the maximum rather
    # than averaging away an overloaded device.
    return max(device["deviceUtilizationPercent"] for device in devices), devices


class CPUSampler:
    def __init__(self):
        self.lib = ctypes.CDLL(ctypes.util.find_library("System"))
        self.lib.mach_host_self.restype = ctypes.c_uint
        self.lib.host_statistics.argtypes = [ctypes.c_uint, ctypes.c_int, ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        self.lib.host_statistics.restype = ctypes.c_int
        self.host = self.lib.mach_host_self()
        self.previous = None
        self.previous_time = None

    def sample(self):
        ticks = (ctypes.c_uint * 4)()
        count = ctypes.c_uint(4)
        result = self.lib.host_statistics(self.host, 3, ticks, ctypes.byref(count))
        if result != 0 or count.value != 4:
            raise RuntimeError(f"host_statistics failed: {result}, count {count.value}")
        now = time.monotonic()
        value = cpu_percent(self.previous, list(ticks))
        window = now - self.previous_time if self.previous_time is not None else None
        self.previous, self.previous_time = list(ticks), now
        return value, window


def sample_gpu():
    result = subprocess.run(
        ["/usr/sbin/ioreg", "-r", "-c", "IOAccelerator", "-d", "1", "-a"],
        capture_output=True, timeout=0.75, check=True,
    )
    return gpu_from_registry(plistlib.loads(result.stdout))


class Guard:
    """Advisory finite state machine; it never modifies any system process."""
    def __init__(self):
        self.paused = False
        self.reduced = False
        self.low_since = None
        self.reason = "warming_up"

    def update(self, cpu, gpu, now):
        if not valid_percent(cpu) or not valid_percent(gpu):
            self.paused = True
            self.low_since = None
            self.reason = "reading_unavailable"
        elif max(cpu, gpu) >= THRESHOLDS["pauseAt"]:
            self.paused = True
            self.reduced = True
            self.low_since = None
            self.reason = "limit_reached"
        elif self.paused or self.reduced:
            if max(cpu, gpu) < THRESHOLDS["resumeBelow"]:
                self.low_since = now if self.low_since is None else self.low_since
                if now - self.low_since >= THRESHOLDS["resumeAfterSeconds"]:
                    if self.paused:
                        # Resume paused rendering at reduced load first.
                        self.paused = False
                        self.reduced = True
                        self.low_since = now
                        self.reason = "resumed_at_reduced_load"
                    else:
                        self.reduced = False
                        self.low_since = None
                        self.reason = "within_budget"
                else:
                    self.reason = "cooling_down" if self.paused else "reduced_load"
            else:
                self.low_since = None
                self.reason = "waiting_for_headroom" if self.paused else "near_limit"
        elif max(cpu, gpu) >= THRESHOLDS["reduceAt"]:
            self.reduced = True
            self.low_since = None
            self.reason = "near_limit"
        else:
            self.reason = "within_budget"
        state = "paused" if self.paused else "reduced" if self.reduced else "normal"
        countdown = None
        if self.low_since is not None:
            countdown = max(0, round(THRESHOLDS["resumeAfterSeconds"] - (now - self.low_since), 2))
        return {
            "state": state, "reason": self.reason, "allowRender": not self.paused,
            "fpsLimit": 0 if self.paused else 15 if self.reduced else 30,
            "resolutionScale": 0 if self.paused else 0.65 if self.reduced else 1,
            "recoverySecondsRemaining": countdown,
        }


def unavailable_guard(reason):
    return {"state": "paused", "reason": reason, "allowRender": False, "fpsLimit": 0, "resolutionScale": 0, "recoverySecondsRemaining": None}


class Monitor:
    def __init__(self, log_path, interval=1):
        self.interval = interval
        self.log_path = pathlib.Path(log_path)
        self.cpu = CPUSampler()
        self.guard = Guard()
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.snapshot = None
        self.monotonic_at = None
        self.sequence = 0

    def collect(self):
        errors = []
        cpu, window, gpu, devices = None, None, None, []
        try:
            cpu, window = self.cpu.sample()
        except Exception as exc:
            errors.append(f"CPU: {type(exc).__name__}: {exc}")
        try:
            gpu, devices = sample_gpu()
            if gpu is None:
                errors.append("GPU: driver Device Utilization % unavailable")
        except Exception as exc:
            errors.append(f"GPU: {type(exc).__name__}: {exc}")
        now = time.monotonic()
        self.sequence += 1
        sample = {
            "schemaVersion": 1, "sampleId": self.sequence,
            "sampledAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sampledAtEpochMs": round(time.time() * 1000),
            "cpuPercent": cpu, "gpuPercent": gpu,
            "available": valid_percent(cpu) and valid_percent(gpu),
            "cpuAvailable": valid_percent(cpu), "gpuAvailable": valid_percent(gpu),
            "intervalSeconds": self.interval,
            "cpuSampleWindowSeconds": round(window, 4) if window is not None else None,
            "gpuDevices": devices,
            "sources": {"cpu": CPU_SOURCE, "gpu": GPU_SOURCE},
            "gpuWindowNote": "Driver-reported utilization; driver averaging window is unspecified. Polled once per second.",
            "thresholds": THRESHOLDS,
            "guard": self.guard.update(cpu, gpu, now),
            "monitorOnly": True,
            "scope": "whole_machine; all applications included",
            "errors": errors,
        }
        with self.lock:
            self.snapshot = sample
            self.monotonic_at = now
        return sample

    def read(self):
        with self.lock:
            if self.snapshot is None:
                return {"schemaVersion": 1, "available": False, "cpuPercent": None, "gpuPercent": None, "sampleAgeSeconds": None, "stale": True, "monitorOnly": True, "guard": unavailable_guard("warming_up")}
            snapshot = dict(self.snapshot)
            age = time.monotonic() - self.monotonic_at
        snapshot["sampleAgeSeconds"] = round(age, 3)
        snapshot["stale"] = age > STALE_SECONDS
        if snapshot["stale"]:
            snapshot["available"] = False
            snapshot["guard"] = unavailable_guard("stale_reading")
        return snapshot

    def run(self, duration=None):
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        with self.log_path.open("a", buffering=1) as log:
            while not self.stop.is_set() and (duration is None or time.monotonic() - started < duration):
                tick = time.monotonic()
                log.write(json.dumps(self.collect(), allow_nan=False) + "\n")
                self.stop.wait(max(0, self.interval - (time.monotonic() - tick)))
        self.stop.set()


def handler_for(monitor):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            origin = self.headers.get("Origin")
            if origin is not None and origin not in ALLOWED_ORIGINS:
                self.send_error(403, "Only the local GIS viewer may read this monitor")
                return
            if self.path.split("?", 1)[0] not in ("/api/resources", "/health"):
                self.send_error(404)
                return
            payload = monitor.read()
            data = json.dumps(payload, allow_nan=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8796)
    parser.add_argument("--duration", type=float, help="Stop after this many seconds")
    parser.add_argument("--log", type=pathlib.Path)
    parser.add_argument("--sample-only", action="store_true", help="Collect a bounded log without an HTTP listener")
    args = parser.parse_args()
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = args.log or pathlib.Path(__file__).resolve().parents[1] / "qa" / f"resource-monitor-{stamp}.jsonl"
    monitor = Monitor(log_path)
    if args.sample_only:
        monitor.run(args.duration or 3)
        print(json.dumps(monitor.read(), indent=2))
        return
    # Never reuse or terminate another project's listener on this port.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(monitor))
    server.timeout = 0.25
    worker = threading.Thread(target=monitor.run, kwargs={"duration": args.duration}, daemon=True)
    worker.start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: monitor.stop.set())
    print(json.dumps({"url": f"http://127.0.0.1:{args.port}/api/resources", "log": str(log_path), "monitorOnly": True}), flush=True)
    try:
        while not monitor.stop.is_set():
            server.handle_request()
    finally:
        monitor.stop.set()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
