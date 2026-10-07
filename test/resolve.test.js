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
  assert.deepEqual(p.pieces[0].outline.origin, { x: 30, y: 0 });
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
