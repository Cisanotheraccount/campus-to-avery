# A walk to Avery

Assignment 4 · GIS for Design Practices · Ci Song · November 2026

An interactive walk from the upper Low Plaza steps to the forecourt near Avery Hall. The default experience uses one continuous Gaussian-splat reconstruction and the original 116 captured camera positions (outdoor-main frames 65–180). It follows the recorded walk around Low and Uris, rather than calculating a shortest path.

## Open and explore

The public website runs in a WebGL2 browser without an account or a local monitoring service. Select **Preview the walk** to load the scan, then **Walk the route** to follow it. Pause, drag to look around, use the progress control, or return to Low Plaza. W/S and the touch controls move along the route; A/D provide a limited sideways view. **Overview** presents a route diagram in scan coordinates.

A translucent light-blue guide follows the recorded route near the estimated pavement. Its soft edges, directional flow and flat markings let the scanned ground remain visible. It is an illustrative overlay, not surveyed surface geometry or a collision-tested navigation route. Outgoing guidance is limited around bends to reduce visible overlap with scenery; the scan has no verified depth-occlusion mesh.

**Columbia ↗** opens the searchable three-campus building and space index. **i** opens project information and sources. The earlier three-scene experiment, including Avery's basement and an explicitly schematic transition, is retained at `?experience=connected`.

The endpoint is **near Avery**, not a verified entrance or classroom door. No campus-gate coverage, real-time access, distance, journey time, accessibility or GPS positioning is claimed. World coordinates are uncalibrated display units.

## Run from source

Requires Node 22.12+ (or Node 20.19+) and a WebGL2 browser. The three compressed models are included in `public/models/`; no training, API key or model download service is required.

```sh
npm ci
npm test
npm run build
npm run preview
```

Open the local address printed by Vite. `dist/` is the complete static website and can also be served by any static HTTP server. Opening `index.html` through `file://` is unsupported. The relative Vite base supports a project subdirectory on GitHub Pages.

The editable source is in `src/`; `public/data/outdoor-route-poses.json` exports the selected source trajectory. Dependencies are pinned in `package-lock.json`. The repository's Pages workflow installs from that lockfile, runs the tests and publishes only the resulting `dist/`.

## Production testing and resources

Normal interaction targets 30 fps with a controlled rendering resolution. It does not wait for resource telemetry. Ci explicitly lifted the CPU/GPU limit for this final production session. The optional local `?resources=guarded` mode is retained for future conservative testing, not the public entry link.

On the tested Mac, run `python3 scripts/resource-monitor.py` before a guarded local session. The monitor samples normalized whole-machine CPU and GPU use once per second. A reading at or above 80% pauses this project's renderer; recovery requires both readings below 60% for ten seconds. Guarded mode also lowers frame rate and resolution. Other applications are not controlled, and an in-flight decode or sort may finish after a pause. This is application throttling, not a guaranteed instantaneous device-wide cap.

For a combined local static server and monitor, after building, use `python3 scripts/serve-review.py`. It refuses to take over occupied ports and stops only the services it starts. The public experience has no dependency on this launcher.

## Data, authorship and limitations

- Models: Ci Song's Columbia 360 capture, reconstructed with COLMAP and Brush. The original complete main, tail and indoor SPZ assets are retained.
- Rendering: Three.js and Spark; build system: Vite.
- Campus map: the course Plain HTML / maplibre-yaml template, the Columbia Blue style and sourced building/space records from earlier assignments.
- Code: generated and adapted with OpenAI Codex at Ci Song's request. Ci confirmed instructor permission for this use; this is not represented as independently handwritten code.

[Method and limitations](public/METHOD.md) and [code/data sources](public/CODE_SOURCES.txt) provide the detailed provenance. Historical local QA records are not published as current acceptance evidence. The handoff includes a fresh release validation report separately.

Fine paving detail remains limited by the reconstruction. Increasing browser resolution cannot recover texture absent from the model. The nearby-splat coverage correction is retained; no scan detail or route geometry was synthesized to conceal missing information. No paused training was resumed for this release.

Public publication and Canvas submission are separate actions. Ci reviews and submits the finished work.
