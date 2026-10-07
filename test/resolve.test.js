const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./load');
const { model, layout, geom: G, resolve } = LT;

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const area = (contour) => G.signedArea(G.buildPrimitives(contour));
const settings = { holeDiameter: 2, spacing: 4, edgeDistance: 3, stitchOffset: 4 };

function card() {
  return model.newPiece('Card', model.rectangle(100, 60, 0, 0, 0, 'holes'));
}

test('half-circle notch centred on the top edge', () => {
  const pc = card();
  pc.notches.push(model.newNotch(2, 20, 10)); // edge 2 = top, drawn right to left
  const r = resolve.resolvePiece(pc);
  assert.ok(r.report.notches[pc.notches[0].id].ok);
  assert.ok(near(area(r.outline), 6000 - (Math.PI * 100) / 2, 1e-6));
  const b = G.bbox(G.buildPrimitives(r.outline));
  assert.ok(near(b.maxY, 60) && near(b.maxX, 100));
  // The deepest point of the notch is 10 mm below the top edge at x = 50.
  const pts = G.samplePoints(G.buildPrimitives(r.outline), 400);
  const low = pts.filter((p) => near(p.x, 50, 0.3)).map((p) => p.y);
  assert.ok(low.some((y) => near(y, 50, 0.05)));
  // Notch edges follow the edge's mode.
  assert.ok(r.outline.segments.filter((s) => s.ref.startsWith('n:')).every((s) => s.mode === 'holes'));
});

test('shallow and oblong notches have the right depth and area', () => {
  for (const depth of [4, 25]) {
    const pc = card();
    pc.notches.push(model.newNotch(0, 20, depth)); // bottom edge
    const r = resolve.resolvePiece(pc);
    const b = G.bbox(G.buildPrimitives(r.outline));
    assert.ok(near(b.minY, 0));
    const pts = G.samplePoints(G.buildPrimitives(r.outline), 800);
    const deepest = Math.max(...pts.filter((p) => p.x > 41 && p.x < 59).map((p) => p.y));
    assert.ok(near(deepest, depth, 0.05), `depth ${depth}: ${deepest}`);
    if (depth === 25) {
      const expected = 6000 - (20 * 15 + (Math.PI * 100) / 2);
      assert.ok(near(area(r.outline), expected, 1e-6));
    }
  }
});

test('notch offset from the edge start, and rounded mouth corners', () => {
  const pc = card();
  const n = model.newNotch(0, 20, 10);
  n.at = 20;
  n.corners.L.fillet = 3;
  n.corners.R.fillet = 3;
  pc.notches.push(n);
  const r = resolve.resolvePiece(pc);
  assert.ok(near(r.report.notches[n.id].at, 20));
  const prims = G.buildPrimitives(r.outline);
  const fillets = prims.filter((p) => p.fillet !== undefined);
  assert.equal(fillets.length, 2);
  fillets.forEach((f) => assert.ok(near(f.r, 3, 1e-6)));
  // Rounding removes material at both mouth corners, so the area grows.
  assert.ok(area(r.outline) < 6000 - (Math.PI * 100) / 2);
  // Every primitive joins the next one.
  prims.forEach((p, i) => assert.ok(G.dist(G.primEnd(p), G.primStart(prims[(i + 1) % prims.length])) < 1e-6));
});

test('a notch that does not fit is reported and skipped', () => {
  const pc = card();
  pc.notches.push(model.newNotch(1, 80, 10)); // right edge is 60 long
  const r = resolve.resolvePiece(pc);
  assert.equal(r.report.notches[pc.notches[0].id].ok, false);
  assert.ok(near(area(r.outline), 6000));
});

test('live cut shape: thumb notch stays editable and rebuilds when moved', () => {
  const pc = card();
  const circ = model.newShape(model.circle(10, 50, 60, 'none'), 'cut');
  pc.cutouts.push(circ);
  let r = resolve.resolvePiece(pc);
  assert.ok(near(area(r.outline), 6000 - (Math.PI * 100) / 2, 1e-6));
  assert.equal(r.cutouts.length, 0);
  // Move the circle down into the piece: more is cut away.
  circ.start.y -= 5;
  r = resolve.resolvePiece(pc);
  assert.ok(area(r.outline) < 6000 - (Math.PI * 100) / 2);
  // The corners where the circle meets the edge can be rounded.
  const joins = r.outline.segments.filter((s) => s.vref.startsWith('j:'));
  assert.equal(joins.length, 2);
  joins.forEach((s) => (circ.joins[s.vref.split(':').slice(2).join(':')] = { fillet: 2, corner: true }));
  r = resolve.resolvePiece(pc);
  const f = G.buildPrimitives(r.outline).filter((p) => p.fillet !== undefined);
  assert.equal(f.length, 2);
});

test('shape set to hole stays a separate cutout with its own origin', () => {
  const pc = card();
  const slot = model.newShape(model.rectangle(30, 10, 0, 35, 25, 'holes'));
  slot.origin = { x: 40, y: 29 };
  pc.cutouts.push(slot);
  const lay = layout.layoutPiece({ defaults: settings }, pc);
  assert.equal(lay.cutouts.length, 1);
  assert.equal(lay.cutouts[0].src, slot.id);
  assert.equal(lay.cutouts[0].origin.kind, 'hole');
});

test('corner settings survive a live merge', () => {
  const pc = card();
  pc.outline.segments[1].fillet = 5; // bottom-right corner
  const tab = model.newShape(model.rectangle(20, 10, 0, -10, 20, 'none'), 'merge');
  pc.cutouts.push(tab);
  const r = resolve.resolvePiece(pc);
  const seg = r.outline.segments.find((s) => s.vref === 'o:1');
  assert.ok(seg && seg.fillet === 5);
  assert.ok(near(area(r.outline), 6000 + 100 - 25 + (25 * Math.PI) / 4, 1e-6));
});

test('version 1 projects: zero point becomes the outline origin', () => {
  const old = { name: 'Old', pieces: [{ name: 'A', outline: model.rectangle(100, 60), cutouts: [model.rectangle(10, 10, 0, 20, 20)], zero: { enabled: true, edge: 0, offset: 30 }, customSettings: true, settings: { spacing: 5 } }] };
  const p = model.normalizeProject(old);
  const os = p.pieces[0].outline.origins;
  assert.equal(os.length, 1);
  assert.equal(os[0].name, 'A');
  assert.deepEqual({ x: os[0].x, y: os[0].y }, { x: 30, y: 0 });
  assert.equal(p.pieces[0].outline.origin, undefined);
  assert.equal(p.pieces[0].cutouts[0].op, 'hole');
  assert.ok(p.pieces[0].cutouts[0].id);
  assert.equal(p.pieces[0].customSettings, undefined);
});

test('resizing a piece keeps corner radii, shape sizes and centring', () => {
  const pc = model.newPiece('P', model.rectangle(100, 60, 5, 0, 0, 'holes'));
  const slot = model.newShape(model.rectangle(30, 10, 0, 35, 25)); // centred
  const right = model.newShape(model.circle(5, 90, 30)); // near the right edge
  pc.cutouts.push(slot, right);
  pc.notches.push(model.newNotch(2, 20, 10));
  resolve.resizePiece(pc, 140, 80);
  const b = resolve.rawBox(pc.outline);
  assert.ok(near(b.maxX - b.minX, 140) && near(b.maxY - b.minY, 80));
  assert.ok(near(b.minX, 0) && near(b.maxY, 60)); // top-left stays put
  assert.ok(pc.outline.segments.every((s) => s.fillet === 5));
  const sb = resolve.rawBox(slot);
  assert.ok(near(sb.maxX - sb.minX, 30) && near((sb.minX + sb.maxX) / 2, 70) && near((sb.minY + sb.maxY) / 2, 20));
  const rb = resolve.rawBox(right);
  assert.ok(near((rb.minX + rb.maxX) / 2, 130));
  const r = resolve.resolvePiece(pc);
  assert.ok(r.report.notches[pc.notches[0].id].ok);
});

test('resizing a shape about its centre, and a circle by diameter', () => {
  const sh = model.newShape(model.rectangle(30, 10, 2, 35, 25));
  resolve.resizeShape(sh, 40, 12);
  const b = resolve.rawBox(sh);
  assert.ok(near(b.maxX - b.minX, 40) && near(b.maxY - b.minY, 12));
  assert.ok(near((b.minX + b.maxX) / 2, 50) && near((b.minY + b.maxY) / 2, 30));
  const c = model.newShape(model.circle(10, 50, 50));
  resolve.resizeShape(c, 30, NaN);
  const cb = resolve.rawBox(c);
  assert.ok(near(cb.maxX - cb.minX, 30, 1e-3) && near((cb.minX + cb.maxX) / 2, 50, 1e-3));
});

// ---------------------------------------------------------------------
// Cut lines, square notches and slots

function lineCut(a, b, remove, target) {
  const pc = card();
  const ln = model.newLine(a, b, target);
  ln.remove = remove;
  pc.lines.push(ln);
  return { pc, ln };
}

test('a line from an edge to a corner cuts the corner off', () => {
  const pc = model.newPiece('Sq', model.rectangle(100, 100, 0, 0, 0, 'holes'));
  const ln = model.newLine({ x: 0, y: 60 }, { x: 100, y: 100 });
  ln.remove = 'left';
  pc.lines.push(ln);
  const r = resolve.resolvePiece(pc);
  assert.ok(near(area(r.outline), 10000 - 2000, 1e-6));
  // The new edge has no holes; the old edges keep theirs.
  const cut = r.outline.segments.filter((s) => s.ref === `l:${ln.id}`);
  assert.equal(cut.length, 1);
  assert.equal(cut[0].mode, 'none');
  assert.ok(r.outline.segments.filter((s) => s.ref.startsWith('o:')).every((s) => s.mode === 'holes'));
  // How much of each edge is kept.
  const ends = r.report.lines[ln.id].ends;
  assert.ok(near(ends.a.kept, 60, 1e-6) && near(ends.a.length, 100, 1e-6));
  assert.ok(near(ends.b.kept, 100, 1e-6));
});

test('a short line stretches to the edges and either side can go', () => {
  // y = x - 20 across a 100 x 60 card: crosses (20, 0) and (80, 60).
  const L = lineCut({ x: 40, y: 20 }, { x: 60, y: 40 }, 'left');
  const R = lineCut({ x: 40, y: 20 }, { x: 60, y: 40 }, 'right');
  const aL = area(resolve.resolvePiece(L.pc).outline);
  const aR = area(resolve.resolvePiece(R.pc).outline);
  assert.ok(near(aL, 3000, 1e-6) && near(aR, 3000, 1e-6));
  const rep = resolve.resolvePiece(L.pc).report.lines[L.ln.id];
  assert.ok(near(rep.P.x, 20, 1e-6) && near(rep.P.y, 0, 1e-6));
  assert.ok(near(rep.Q.x, 80, 1e-6) && near(rep.Q.y, 60, 1e-6));
});

test('a line that misses does nothing, and an unpicked line cuts nothing', () => {
  const miss = lineCut({ x: 200, y: 0 }, { x: 200, y: 10 }, 'left');
  const r = resolve.resolvePiece(miss.pc);
  assert.equal(r.report.lines[miss.ln.id].ok, false);
  assert.ok(near(area(r.outline), 6000, 1e-6));
  const open = lineCut({ x: 0, y: 30 }, { x: 100, y: 30 }, null);
  const r2 = resolve.resolvePiece(open.pc);
  assert.ok(r2.report.lines[open.ln.id].ok);
  assert.ok(near(area(r2.outline), 6000, 1e-6));
});

test('line corners can be rounded and lines also cut shapes', () => {
  const { pc, ln } = lineCut({ x: 0, y: 40 }, { x: 40, y: 60 }, 'left');
  ln.corners.a.fillet = 3;
  const r = resolve.resolvePiece(pc);
  const seg = r.outline.segments.find((s) => s.vref === `l:${ln.id}:a`);
  assert.ok(seg && seg.fillet === 3);
  // A line across a hole shape trims the hole, not the outline.
  const pc2 = card();
  const sh = model.newShape(model.rectangle(20, 20, 0, 40, 20));
  pc2.cutouts.push(sh);
  const l2 = model.newLine({ x: 40, y: 30 }, { x: 60, y: 30 }, sh.id);
  l2.remove = 'left'; // the top half of the hole
  pc2.lines.push(l2);
  const r2 = resolve.resolvePiece(pc2);
  assert.ok(near(area(r2.outline), 6000, 1e-6));
  assert.ok(near(area(r2.cutouts[0].contour), 200, 1e-6));
});

test('square notch has real corners that can be rounded', () => {
  const pc = card();
  const n = model.newNotch(2, 20, 15);
  n.shape = 'square';
  pc.notches.push(n);
  let r = resolve.resolvePiece(pc);
  assert.ok(near(area(r.outline), 6000 - 300, 1e-6));
  n.corners.BL = { fillet: 2, corner: true };
  n.corners.BR = { fillet: 2, corner: true };
  r = resolve.resolvePiece(pc);
  const lost = 2 * (4 - Math.PI); // two 2 mm fillets on the inside corners add material back
  assert.ok(near(area(r.outline), 6000 - 300 + lost, 1e-6));
});

test('slot shape has the right size and area', () => {
  const tall = model.slot(20, 50, 10, 10);
  const b = G.bbox(G.buildPrimitives(tall));
  assert.ok(near(b.maxX - b.minX, 20) && near(b.maxY - b.minY, 50));
  assert.ok(near(area(tall), 30 * 20 + Math.PI * 100, 1e-6));
  const wide = model.slot(50, 20);
  const bw = G.bbox(G.buildPrimitives(wide));
  assert.ok(near(bw.maxX - bw.minX, 50) && near(bw.maxY - bw.minY, 20));
});

test('lines move with the piece and shapes they cut', () => {
  const { pc, ln } = lineCut({ x: 0, y: 40 }, { x: 40, y: 60 }, 'left');
  resolve.resizePiece(pc, 150, 80);
  // The piece grows down and to the right; the line's ends stay on the
  // left and top edges.
  assert.ok(near(ln.a.x, 0) && near(ln.b.y, 60));
  const before = resolve.resolvePiece(pc);
  assert.ok(before.report.lines[ln.id].ok);
  const sh = model.newShape(model.rectangle(20, 20, 0, 40, 20));
  const l2 = model.newLine({ x: 40, y: 30 }, { x: 60, y: 30 }, sh.id);
  resolve.resizeShape(sh, 40, 20, [l2]);
  assert.ok(near(l2.a.x, 30) && near(l2.b.x, 70));
});

test('projects keep their lines when loaded', () => {
  const p = model.newProject();
  p.pieces[0].lines.push(model.newLine({ x: 0, y: 1 }, { x: 2, y: 3 }));
  const q = model.normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.pieces[0].lines.length, 1);
  assert.ok(q.pieces[0].lines[0].corners.a);
  const old = model.normalizeProject({ pieces: [{ outline: model.rectangle(10, 10) }] });
  assert.deepEqual(old.pieces[0].lines, []);
});
