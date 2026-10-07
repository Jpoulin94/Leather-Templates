# Leather Templates

Design leather pattern pieces, add punch holes or a stitch line along the edges you choose, and print them at true 1:1 scale or export them for a laser cutter.

## Using it

The app is a single web page with nothing to install and no internet connection needed.

1. Download the repository (green **Code** button, then **Download ZIP**) and unzip it.
2. Open `index.html` in Chrome, Edge, Firefox or Safari.

### The screen
- **Left**: your pieces (click one to work on it, **+ New** to add a rectangle, circle or drawn piece) and the default stitching sizes.
- **Middle**: the drawing, with the tools down its left side: Select (V), Draw (P), add a rectangle, add a circle, place the zero point, and snap to grid. Scroll to zoom and drag the background to pan.
- **Right**: settings for whatever is selected. With nothing selected it shows the whole piece.
- **Top**: undo and redo, mm or inches, File (new, open, download or load a project file), Save and Export.

### Selecting and changing things
- **Click an edge** to choose Holes, Stitch line or None for it. **Shift-click** to pick several edges at once, or use **All edges** when nothing is selected. With edges selected, the H, S and N keys set the mode.
- **Click a corner dot** to round it with the slider, a typed size or a quick-pick chip, and to turn its corner hole on or off. **Round all corners** and **Hole on every corner** do the whole piece in one step.
- **Click a shape** (cutout) to move it, line it up, combine it with the outline, or delete it. Drag it to move it.
- Press **Esc** or click empty space to go back to the whole piece.
- **Exact dimensions** (in the piece or shape panel) lists every edge, so you can type exact lengths and angles or turn an edge into an arc.

### Drawing and shapes
- **Draw** (pen tool): click points on the grid. Click the first point or press Enter to finish, and Backspace removes the last point. Hold Shift to lock angles to 15° steps. If the piece has no outline yet you draw the outline; otherwise you draw a cutout.
- **Add a rectangle or circle** from the tool rail. It lands in the middle of the piece as a cutout, such as a card slot.
- **Line it up** with the outline or another shape (left, centre or right; top, middle or bottom), or centre it on one of the outline's edges.
- **Combine**: **Cut away** removes the shape's area from the outline, **Merge** adds it, and **Keep overlap** keeps only where they overlap. **Choose lines…** splits both shapes where they cross so you can click exactly which lines to keep. For example, a thumb notch on a card pocket is a circle lined up with **Centre**, centred on the **Top** edge, then **Cut away**.
- **Undo / Redo**: toolbar buttons, or Ctrl+Z and Ctrl+Y (Cmd on a Mac).

### Holes and stitch lines
- Set the hole diameter, the spacing (centre to centre), the distance from the hole's edge to the leather edge, and the stitch-line distance under **Stitching**. Turn on **Own stitching sizes for this piece** to give a piece its own.
- **Corner holes**: a hole always lands exactly on each corner, and the spacing on each side is adjusted slightly so the holes divide evenly. Turn it off for one corner by selecting it. The piece panel shows a spacing check for any run whose spacing was adjusted.
- **Zero point**: switch it on and pick a point on the outline. A hole always lands there, with spacing laid out from it. Give mating pieces the same zero point and settings, and their holes line up.

### Units
Switch between mm and inches at any time. Inputs accept decimals, fractions (`3/16`, `1 1/2`) and a unit suffix (`10mm`, `2"`).

### Output
Click **Export**, then pick the PDF or SVG, the paper size and which pieces to include.
- **Printable PDF (1:1)**: Letter or A4. Print at **100% / Actual size** and measure the check square. Pieces bigger than the page are split across pages: trim each page on the dashed border and line up the + marks.
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
- `js/model.js`: project data, shapes, units
- `js/render.js`, `js/pdf.js`: SVG and PDF output
- `js/storage.js`: saving and file download
- `js/app.js`: user interface
