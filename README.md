# Leather Templates

Design leather pattern pieces, add punch holes or a stitch line along the edges you choose, and print them at true 1:1 scale or export them for a laser cutter.

## Using it

The app is a single web page with nothing to install and no internet connection needed.

1. Download the repository (green **Code** button, then **Download ZIP**) and unzip it.
2. Open `index.html` in Chrome, Edge, Firefox or Safari.

### Drawing a piece
- **Pieces → Add**: start from a rectangle or circle with typed sizes, or choose **Draw my own** and click points on the grid. Click the first point (or press Enter) to finish. Hold Shift to lock angles to 15° steps.
- Every edge is listed in the **Edges** table on the right. Type an exact length and angle for each edge. An edge can also be an **arc** (radius, plus a sweep that turns left when positive and right when negative).
- **Corners** table: give any corner between two straight edges a rounded radius.
- **Cutouts**: add rectangles, circles or drawn shapes inside a piece, such as card slots or a thumb notch. They can have holes or not.

### Holes and stitch lines
- Set the hole diameter, the spacing (centre to centre), the distance from the hole's edge to the leather edge, and the stitch-line distance under **Hole & stitch settings**. A piece can have its own settings.
- Choose **Holes**, **Stitch line** or **Nothing** in the toolbar, then click edges to apply it. Clicking the same edge again clears it.
- **Corner holes**: a hole always lands exactly on each corner, and the spacing on each side is adjusted slightly so the holes divide evenly. Click a corner dot (or untick it in the Corners table) to turn that off. The **Spacing check** shows any run whose spacing was adjusted.
- **Zero point**: pick a point on the outline and a hole always lands there, with spacing laid out from it. Give mating pieces the same zero point and settings, and their holes line up.

### Units
Switch between mm and inches at any time. Inputs accept decimals, fractions (`3/16`, `1 1/2`) and a unit suffix (`10mm`, `2"`).

### Output
- **Printable PDF (1:1)**: Letter or A4. Print at **100% / Actual size** and measure the check square. Pieces bigger than the page are split across pages: trim each page on the dashed border and line up the + marks.
- **Laser SVG**: true size in mm. Red is cut (outline, cutouts, holes) and blue is score or engrave (stitch lines).

### Saving
- **Save** keeps the project in this browser under its name, and **Open…** lists saved projects so you can edit or reprint them.
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
- `js/model.js`: project data, shapes, units
- `js/render.js`, `js/pdf.js`: SVG and PDF output
- `js/storage.js`: saving and file download
- `js/app.js`: user interface
