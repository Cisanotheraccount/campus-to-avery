# A walk to Avery — method and limitations

## Question and representation

How can a student move from a campus building reference toward recognizing the approach to a classroom? The searchable campus map describes what public room directories locate. A captured three-dimensional walk adds a visual account of one approach: Low Plaza to the forecourt near Avery Hall.

## Recorded outdoor route

The default walk preserves all 116 outdoor-main camera positions from frames 65–180. The source panoramas identify the upper Low steps, the Low–Uris court and curl sculpture, and the scaffolded Avery facade. Official campus and building pages corroborate the landmarks. This is visual review, not a current access or entrance survey.

The walk goes around Low and Uris because that is the captured trajectory. It is not a shortest-path calculation. It stops near Avery, before the unverified join to the separate outdoor-tail reconstruction. It does not reach a confirmed campus gate, doorway or classroom.

The route guide is a translucent Three.js surface following the source trajectory. Height is estimated beneath the capture camera; corners are bounded and the visible preview is limited near turns. Soft edges, modest directional flow and flat markings communicate movement without covering the scan. It shares the viewer's capped render loop and uses no full-screen bloom. There is no surveyed pavement, collision mesh or reliable scene-depth occlusion. The guide should therefore be read as an illustrative route overlay.

Camera progress is reversible. The overview is a diagram in scan coordinates because the ground-level capture does not establish a reliable aerial view. No north arrow, metre scale or geographic alignment is inferred.

## Scan and display

The complete outdoor-main reconstruction contains 1,819,765 splats. The separate outdoor tail contains 557,669 and the basement contains 152,590. Existing COLMAP and Brush reconstructions are reused; the SPZ assets and original capture positions are retained.

The former 48-framebuffer-pixel projected-radius cap shrank large nearby splats, exposing the background. The current renderer preserves their coverage using a CSS-pixel-based radius cap adjusted to the drawing buffer. The correction reduces foreground gaps but does not restore missing texture. Paving and some other surfaces remain soft, especially away from recorded views. There is no claim that browser-resolution changes recreate absent detail.

## Campus index

The embedded map contains 84 building or institution reference points and 551 space-name records, including teaching, meeting and support spaces. Twenty-four entries have no mapped reference. A listed floor is an attribute, not a measured room location or a floorplan. Building and institution references are distinguished, and per-record sources are retained. The separate Tutorial 8.2 submission uses the same dataset and remains independently usable.

## Earlier connected study

The optional `?experience=connected` study retains three independent reconstructions and an explicitly schematic doorway, lobby and stair connection. Their scale, rotation and translation are approximate. The original scenes have no shared surveyed reference frame or verified metric scale; the indoor placement is an editorial arrangement, not a measured alignment.

The indoor scene is an existing initial reconstruction of Avery Hall's basement, as confirmed by Ci. No new indoor reconstruction was completed for this release. The narrow route corridor is an interaction constraint, not a collision model or evidence of accessible passage. Scene fades mark unsupported joins. No arbitrary-room routing or real-time access information is provided.

## Performance and validation boundary

The public viewer operates without a local resource monitor. Ci explicitly lifted the CPU/GPU limit for this final production session. A separate optional local guarded mode remains available: CPU or GPU at or above 80% pauses rendering; both below 60% for ten seconds permit a reduced-load recovery. This controls the application, not other software or instantaneous hardware spikes. Previously recorded peaks above 80% are not represented as a passed hard-cap guarantee. Final release tests are recorded separately from historical runs.

## Next evidence

Confirm the route, correct entrance and access conditions on site; capture continuous overlapping footage through the doorway and stairs; add metric and geographic control points; replace schematic joins only after registration and review. These are later steps, not completed features of this assignment.

## Sources

- [Columbia campus map](https://www.law.columbia.edu/sites/default/files/2020-02/cu_morningside_campus_map.pdf)
- [Avery Hall](https://operations.cufo.columbia.edu/content/avery-hall)
- [Uris Hall](https://operations.cufo.columbia.edu/content/uris-hall)
- [Code and data sources](CODE_SOURCES.txt)
- [Campus dataset provenance](campus/sources/data-provenance.json)
