# Local CPU / GPU guard

Run from the Assignment 4 directory:

```sh
python3 scripts/resource-monitor.py
```

The read-only API is `http://127.0.0.1:8796/api/resources`. It binds only to loopback; permitted cross-origin viewers are `http://127.0.0.1:4184` and `http://localhost:4184`. It does not require administrator access, modify processes, or modify GPU settings. Per-second JSONL records go to `qa/resource-monitor-<timestamp>.jsonl`.

CPU is the system-wide fraction of non-idle Mach CPU ticks across all cores, normalized to 0–100%. GPU is the explicit `Device Utilization %` from the macOS GPU driver's IORegistry `IOAccelerator / PerformanceStatistics`. On this Apple M2 Max it is readable without `sudo`. GPU driver averaging duration is unspecified; the monitor polls the metric once per second. These readings include other apps. GPU wattage, memory, frame rate, and renderer utilization are never substituted for device utilization.

## Viewer contract

- Poll once per second. Accept only a successful JSON response with `available === true`, `stale === false`, `sampleAgeSeconds <= 2.5`, and a recent `sampledAtEpochMs`.
- Obey `guard.allowRender`. False means stop rendering and pause preloading/heavy work, keeping the last frame or static cover visible. Network failure, monitor shutdown, missing readings, and invalid JSON also mean stop rendering.
- Apply `guard.fpsLimit` (30 normal; 15 reduced; 0 paused) and `guard.resolutionScale` (1; 0.65; 0). Cap device pixel ratio separately; do not multiply unbounded Retina resolution.
- At either CPU or GPU >= 70%, reduce load. At >= 80%, pause. Resume at reduced load only after both readings remain strictly below 60% for ten continuous seconds; a further ten seconds of headroom restores normal settings.
- Initial CPU sampling needs two readings. Initial unknown readings fail closed and require the same ten-second recovery window.
- The monitor is advisory (`monitorOnly: true`): it cannot pause a browser by itself. A renderer that ignores this response is not guarded. Do not claim an OS-level hard ceiling, whole-system enforcement, or visitor-device monitoring.
- For a public deployment, browser security prevents reading visitor CPU/GPU percentages. The local monitor is a local review/verification feature; any unmonitored public mode must be stated explicitly and must not masquerade as validated compliance.

Bounded measurement: `python3 scripts/resource-monitor.py --duration 600`. This only records system measurements; it does not exercise the application. A ten-minute load test must interact with the real viewer and examine both its guard response and this log. Never launch a stress test to force the thresholds.

Tests: `python3 tests/resource-monitor-test.py`.

Implementation source: macOS Mach `HOST_CPU_LOAD_INFO` and local Apple M2 Max GPU driver data, read through standard-library ctypes/plistlib. AI-assisted implementation (OpenAI Codex), 2026-11-12.
