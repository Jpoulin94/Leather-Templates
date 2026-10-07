# Leather Templates

Design leather pattern pieces, add punch holes or a stitch line along the edges you choose, and print them at true 1:1 scale or export them for a laser cutter.

## Using it

The app is a single web page with nothing to install and no internet connection needed.

1. Download the repository (green **Code** button, then **Download ZIP**) and unzip it.
2. Open `index.html` in Chrome, Edge, Firefox or Safari.

### The screen
- **Left**: your pieces (click one to work on it, **+ New** to add a rectangle, circle or drawn piece), and the **Stitching** section for the whole project: hole size, spacing, how far holes sit from the edge, how far stitch lines sit from the edge (shown once an edge uses a stitch line), the hole count with its spacing check, and the origin points. Click its title to fold it away; it remembers.
- **Middle**: the drawing, with the tools down its left side: Select (V), Draw (P), Line (L), Trim (T), Stitch path (K), add a rectangle, circle or slot, Round corners (R), Origin point (O), and snap to grid. Scroll to zoom and drag the background to pan.
- **Right**: settings for whatever is selected. With nothing selected it shows the whole piece.
- **Top**: undo and redo, mm or inches, File (new, open, download or load a project file), Save and Export.

### Selecting and changing things
- **Click an edge** to choose Holes, Stitch line or None for it. **Shift-click** to pick several edges at once, or use **All edges** when nothing is selected. With edges selected, the H, S and N keys set the mode.
- **Click a corner dot** to turn its corner hole on or off, or to round just that corner.
- **Click a shape** to move it, resize it, line it up, change how it's used, or delete it. Drag it to move it.
- **Shift-click several shapes** to line them up together with **Centre left–right**, **Centre up–down**, or a side. Shift-click inside the piece to include the outline: everything then lines up to the outline, otherwise to the first shape you picked. Dragging one of them moves them all.
- **While dragging a shape**, a pink guide appears when its centre lines up with the centre of the outline or another shape (or its side with a side), and it snaps there. Keep dragging along the guide and it stays centred.
- Press **Esc** or click empty space to go back to the whole piece.

### Size
- With nothing selected, type a new **Width** or **Height** for the piece. Edges stretch while rounded corners, notches and shapes keep their size; a centred shape stays centred.
- Shapes have their own Width and Height (or Diameter for a circle).
- **Exact dimensions** lists every edge, so you can type exact lengths and angles or turn an edge into an arc.

### Rounding corners
Pick a size under **Round corners** (or press R), then click the corner dots you want rounded. Click a corner again to make it sharp, and click it once more to round it again. Pick another size and keep clicking to give other corners a different radius; the newest click wins. Corners are coloured by radius, and the list shows how many corners use each size.

### Notches
Click a straight outline edge and choose **Add a notch to this edge**. It starts as a half circle centred on the edge. Set its **Width** and **Depth** (half the width is a half circle, less is a shallow scoop, more is an oblong U), switch off **Centred** to place it along the edge, and round the corners where it meets the edge. Choose **Square** for a straight-sided notch; its two bottom corners can be rounded too. Holes and stitching follow the notch when its edge has them. Click the notch any time to change it.

### Drawing and shapes
- **Draw** (pen tool): click points on the grid. Click the first point or press Enter to finish, and Backspace removes the last point. Hold Shift to lock angles to 15° steps. If the piece has no outline yet you draw the outline; otherwise you draw a shape.
- **Add a rectangle, circle or slot** from the tool rail. It lands in the middle of the piece. A slot is a rectangle with round ends, like a thumb slot; give it a width and a length.
- **Line** (L): click two points to cut across the piece. The points snap to corners and edges, and the line stretches on its own to the edges it crosses. Then click the part to cut away. The line stays live: click its edge to type how much of each crossed edge to keep, cut away the other part instead, give the new edge holes or a stitch line (it starts with none), or delete it. Its two new corners can be rounded with the Round corners tool. Draw a line across a shape to cut the shape instead.
- **Stitch path** (K): holes or a stitch line anywhere on the piece, without cutting anything, for stitching another piece on. Click to place points; each click carries the line on from the last one. Points snap to holes, corners and the grid, and Shift gives 15° steps. Press **Finished** or Enter to end it, or click the first point to close it into a loop. The holes sit right on the line, with a hole on each end and each bend (click a bend's dot to switch its hole off, or round it with Round corners). Click the path to switch it to a stitch line, type each leg's length, move it by its start point, or delete it.
- **Trim** (T): every line is split wherever it crosses another line. Click the pieces you want gone, then Apply, and what's left joins into one shape (for example a rectangle and two circles into a thumb slot). Like Choose lines, the result is fixed lines.
- **Use it as**: a **Hole** inside the piece (a card slot), **Cut away** from the outline, **Merge** into the outline, or **Overlap** (keep only where they overlap). Combined shapes stay live: move, resize or switch them back at any time and the piece updates. The corners where a combined shape meets the outline can be rounded too.
- **Line it up** with the outline or another shape (left, centre or right; top, middle or bottom), or centre it on one of the outline's edges.
- **Choose lines…** splits the outline and the shape where they cross so you can click exactly which lines to keep. This one makes the outline fixed, so notches and combined shapes become plain lines.
- **Undo / Redo**: toolbar buttons, or Ctrl+Z and Ctrl+Y (Cmd on a Mac).

### Holes and stitch lines
- Set the hole diameter, the spacing (centre to centre), the distance from the hole's edge to the leather edge, and the stitch-line distance under **Stitching**. Every piece uses the same sizes.
- **Spacing is always exact.** Every hole is exactly the set spacing from the next, so a multi-hole punch fits every hole.
- **Corner holes**: where two edges with holes meet, a hole lands exactly on the corner. Turn it off for one corner by clicking it. The spacing between holes never changes. If the distance between two corner holes (or the bends and ends of a stitch path) isn't a whole number of spaces, the hole at the far corner is left out: the stitching turns just before it, and the spot is drawn dashed in red. **Stitching** lists each one with two ways to get the hole back: **Change dimensions** makes that side longer to the next length that fits, and **Make distance from edge shorter** lowers **Holes from edge** for every edge, so the holes stay the same distance from each side (it says when a distance still leaves other sides that don't fit). Only between two origin points is a short gap left, shown in red. Hover a fix to see the side on the drawing.
- **Edges without holes**: where an edge with holes meets an edge without holes, that edge is ignored: the holes keep exactly the set spacing, counted from the nearest corner hole or origin point (or from the start of the edge), and carry on right up to it as long as each leaves at least 0.5 mm of leather. If the next hole would touch or cross that edge, so the edge would cut through a hole on a piece stacked with this one, **Stitching** flags it and rings the hole on the drawing. Click a suggestion to move the edge to the nearest spot that clears the hole, or type your own distance and choose **Longer** or **Shorter**. Edges of notches can't be moved this way; for a Line, you can also type the kept length in its settings.
- **Origin points**: choose **Add an origin point** (or press O), then click a hole or a stitch line. A hole stays put there and the others space out exactly from it; on a stitch line a short tick marks the spot on the print. A piece can have as many as you need, on the outline, shapes or stitch paths. Each gets a letter (A, B, C…) that you can rename under **Stitching**, for example "Pocket". The names are printed next to them.

### Assemble
Switch the top bar from **Edit** to **Assemble** to see your pieces stacked flat on top of each other, each in its own colour. Tick the pieces to include on the left, bottom first. Each piece lines up on an origin whose name it shares with a piece below it, so a pocket with origin "Pocket" sits on the back's "Pocket" origin while a strap lines up on "Strap". A piece with no shared name puts its first origin on the first piece's; a piece without any origin is centred.
- Drag a piece to shift it, or type how far it sits from the origin. **↺ 90° / ↻ 90°** rotate it and **Turn over** flips it for a piece that sits face down.
- **Shared holes**: wherever one piece's holes sit on another piece, the stitch goes through both, so both need a hole there. Holes that don't line up are circled in red, and the panel counts them for each pair of pieces.
- **Download picture (SVG)** saves the stack at true size with a colour key. The arrangement is saved with the project; go back to **Edit** to change a piece and the stack updates.

### Units
Switch between mm and inches at any time. Inputs accept decimals, fractions (`3/16`, `1 1/2`) and a unit suffix (`10mm`, `2"`).

### Output
Click **Export**, then pick the PDF or SVG, the paper size and which pieces to include.
- **Printable PDF (1:1)**: Letter or A4. Print at **100% / Actual size** and measure the check square on each page: it should be exactly 20 mm. Pieces bigger than the page are split across pages: trim each page on the dashed border and line up the + marks.
- **Laser SVG**: true size in mm. Red is cut (outline, cutouts, holes) and blue is score or engrave (stitch lines).

### Saving
- **Save** keeps the project in this browser under its name, and **File → Open saved project…** lists saved projects so you can edit or reprint them.
- Your current work is also kept automatically if the page is closed.
- **Download project file** / **Load project file…** back a project up, or move it to another computer or browser.

## Development

Plain HTML, CSS and JavaScript with no build step and no dependencies.

```
npm test        # geometry, layout, PDF and SVG tests (Node 18+)
npm start       # optional: serve the folder on http://localhost:8080
```

- `js/geometry.js`: contours, fillets, offsets and intersections
- `js/layout.js`: hole and stitch-line placement
- `js/boolean.js`: combining shapes (cut away, merge, overlap, choose lines)
- `js/assembly.js`: the Assemble view's stacking and shared-hole check
- `js/clearance.js`: edges without holes that cut through a hole, sides that don't divide evenly, and the fixes for both
- `js/resolve.js`: builds each piece from its outline, notches, live shapes and cut lines; resizing
- `js/model.js`: project data, shapes, units
- `js/render.js`, `js/pdf.js`: SVG and PDF output
- `js/storage.js`: saving and file download
- `js/app.js`: user interface
