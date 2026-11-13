# Columbia Campus Index — Tutorial 8.2

Local review version. Not published or submitted.

## Open locally

From this directory:

```sh
python3 -m http.server 4182 --bind 127.0.0.1
```

Visit `http://127.0.0.1:4182/full-page-map.html`. This is a static website with no build step. Do not open through `file://`. Port 4182 is a suggestion; verify it is free before starting a server.

## Explore

Switch between Morningside, Manhattanville and CUIMC. Click building reference points or use **Find a space** to search building names, aliases, codes and room labels. Room-number matches are grouped by building to avoid mixing identically numbered rooms. Coincident references stay at their original positions; a click lists all building records at the location. Source links open from each building or directory entry.

The information button explains the symbols and limits. The point layer contains 84 references: 83 buildings and one institution location. The 551 space-name entries include teaching, meeting and support spaces; 24 have no located reference. 527 are linked to a point (525 building-level and two institution-level). No room coordinates are available. This is not a complete campus classroom census.

When embedded by Assignment 4 at the same origin, Avery has an **Explore scanned basement** button. It sends `{type: 'avery-explore', buildingId: 'operations-avery-hall'}` to the embedding page. It does not navigate to a fixed localhost address. The standalone tutorial has no 3D dependency.

## Teacher's structure

`full-page-map.html` uses `<ml-map src="maps/full-page.yaml">`, adapted from the current [Plain HTML template](https://github.com/design-practices/html-maplibre-template/). `maps/full-page.yaml` controls the map, styles and point layers. `style.json` is the unchanged Columbia Blue Tutorial 8.1 style. `js/campus.js` adds directory search and selection. All project URLs are relative and compatible with a GitHub Pages subpath.

MapLibre 6.12.0 and maplibre-yaml 0.10.2 are vendored for predictable loading. Basemap tiles, fonts and sprites still need an internet connection. No API key is required. The map uses one worker, pixel ratio 1 and non-animated campus jumps; there is no continuous render loop. These measures reduce workload but do not independently certify an 80% system CPU/GPU cap.

## Check and reproduce

```sh
python3 scripts/validate.py
node --check js/campus.js
npx --yes @maplibre-yaml/cli@0.7 validate maps
```

To regenerate data inside the original course workspace, run `python3 scripts/prepare_data.py`. Published copies already include all necessary derivatives. It never changes Assignment 2 or Tutorial 8.1. The input hashes and data limits are saved in `sources/data-provenance.json`.

The local QA report distinguishes static checks from browser/render checks. Use `window.campusReview` after map readiness for browser QA: `{map, buildings, spaces, showBuilding}`.

## Review and submission

The tutorial asks for the **GitHub repository URL** and **published web map URL**. Neither has been created for this new version. A prepared manual GitHub Pages workflow is included; publication remains subject to Ci's review. A4 is a separate deliverable and retains its own source documentation.

Code, data, and AI-assistance provenance: [CODE_SOURCES.txt](CODE_SOURCES.txt).

## Browser verification update

Verified the final static map in a headless browser: all three campus views, building and room-number search, the shared Mudd/Engineering Terrace point, the Fayerweather203 floor conflict, standalone/embedded Avery behavior, and390px mobile layout. No browser errors. Evidence: qa/browser-checks.json and screenshots. Local only; no repository push, public deployment or Canvas submission.
