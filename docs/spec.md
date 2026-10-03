# Leather Cutting Template Generator: Spec (draft v1)

Last updated: 2026-10-03. Status: approved by Jesse on 2026-10-03; first version built in the Leather-Templates repo.

## Purpose
Design leather pattern pieces, add punch holes or a stitch line along chosen edges, and output templates to trace onto leather (printed 1:1) or to cut on a laser (SVG).

## Platform
- Web app that runs in the browser, with nothing to install.

## Units
- Switchable between mm and inches at any time. Values convert; the geometry does not change.

## Drawing (shape editor)
- CAD-style editor. Tools: straight line, arc, rounded corner (fillet). No freehand or bezier curves.
- Every segment is dimensioned by typed values (length, angle, radius), not just dragged.
- Grid and snapping to endpoints.
- **Inner cutouts:** closed shapes inside an outline (card slots, notches). A cutout may or may not have holes.

## Holes and stitch lines
Each edge has a mode: punch holes, stitch line, or nothing. Sizes are project-wide defaults, which a piece can override:
- **Hole diameter** (round holes only).
- **Hole spacing:** center to center.
- **Edge distance:** from the hole edge to the leather edge.
- **Stitch line offset:** distance from the leather edge, used when the mode is stitch line.

Placement rules:
- Click individual edges (outline or cutout) to toggle holes or stitch line on them.
- **Sharp corners always get a hole.** Spacing between two corners is adjusted slightly so the holes divide evenly. Each corner can be deselected, and its spacing then runs through without a forced hole.
- On arcs and rounded corners, holes follow the curve at the set spacing. The corner rule applies only to sharp corners.
- The app shows the actual spacing used on each edge whenever it differs from the requested spacing.

## Multiple pieces and alignment
- One project holds multiple pieces (for example a wallet's front, back and pocket).
- **Selectable zero point:** you pick a reference point on each piece, and hole spacing is laid out from that point. Mating pieces that share the same zero point and settings then have holes that line up when stacked. *(Confirmed by Jesse.)*

## Output
- **Printable PDF at true 1:1 scale.** Letter by default, with A4 as an option. Pieces larger than the page tile across pages with alignment marks. Each page includes a scale-check square (1 in and 25 mm) to measure after printing.
- **SVG for laser cutting** at real-world units. Cut lines (outline, cutouts, holes) and the score/engrave stitch line go on separate layers or colors.
- Choose which pieces to export.

## Saving
- Save a project by name, and reopen it later to edit or reprint.
- Default: saved in the browser, with a project list on the start screen. It also exports and imports as a file for backup or for moving to another computer.

## Out of scope for v1
- Freehand or bezier curves; non-round holes (diamond or slanted).
- Automatic hole-count matching between mating edges (the zero point covers alignment for now).
- Importing existing SVG/DXF drawings.
- Accounts or cloud sync.

## Decisions
- Code lives in the GitHub repo Jpoulin94/Leather-Templates, as a plain web page with no install and no build step.
- Hole spacing is measured centre to centre.
- Hole sizes are set per project or per piece, not per edge.
