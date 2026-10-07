const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./load');
const { model, layout, geom: G } = LT;

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const settings = { holeDiameter: 2, spacing: 4, edgeDistance: 3, stitchOffset: 4 };
const hasPoint = (pts, x, y, tol = 1e-6) => pts.some((p) => near(p.x, x, tol) && near(p.y, y, tol));

function gaps(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push(G.dist(points[i - 1], points[i]));
  return out;
}

test('rectangle: exact spacing on each side; a corner hole is left out where a side doesn’t fit', () => {
  const c = model.rectangle(100, 50, 0, 0, 0, 'holes');
  const r = layout.layoutContour(c, settings, { isOutline: true });
  // Hole centres sit 3 + 1 = 4 mm in from the edges. The 42 mm sides
  // don't fit 4 mm spaces, so the corner holes at their far ends go.
  for (const [x, y] of [[96, 4], [4, 46]]) assert.ok(hasPoint(r.holes, x, y), `corner ${x},${y}`);
  for (const [x, y] of [[96, 46], [4, 4]]) assert.ok(!hasPoint(r.holes, x, y), `no corner ${x},${y}`);
  assert.equal(r.removed.length, 2);
  // 92 mm side / 4 = 23 gaps exactly.
  const bottom = r.holes.filter((p) => near(p.y, 4)).sort((a, b) => a.x - b.x);
  assert.equal(bottom.length, 23);
  gaps(bottom).forEach((g) => assert.ok(near(g, 4)));
  // 42 mm side: spacing stays exactly 4; the last hole is 2 mm short of
  // the corner, which has no hole.
  const right = r.holes.filter((p) => near(p.x, 96)).sort((a, b) => a.y - b.y);
  gaps(right).forEach((x) => assert.ok(near(x, 4)));
  assert.ok(near(right[right.length - 1].y, 44));
  assert.equal(r.sections.filter((s) => s.uneven).length, 0);
  const dropped = r.sections.filter((s) => s.dropped);
  assert.equal(dropped.length, 2);
  dropped.forEach((s) => {
    assert.ok(near(s.length, 42));
    assert.ok(near(s.gap, 2));
    assert.equal(s.oddKind, 'corner');
  });
  // No duplicates.
  const keys = new Set(r.holes.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`));
  assert.equal(keys.size, r.holes.length);
});

test('clockwise rectangle still puts holes inside', () => {
  const c = model.rectangle(100, 50, 0, 0, 0, 'holes');
  // Redraw clockwise: up, right, down, left.
  c.segments = [
    model.seg('line', { length: 50, angle: 90, mode: 'holes' }),
    model.seg('line', { length: 100, angle: 0, mode: 'holes' }),
    model.seg('line', { length: 50, angle: 270, mode: 'holes' }),
    model.seg('line', { length: 100, angle: 180, mode: 'holes' }),
  ];
  const r = layout.layoutContour(c, settings, { isOutline: true });
  assert.ok(hasPoint(r.holes, 4, 4));
  r.holes.forEach((p) => assert.ok(p.x > 0 && p.x < 100 && p.y > 0 && p.y < 50));
});

test('deselected corner gets no forced hole', () => {
  const c = model.rectangle(99, 50, 0, 0, 0, 'holes');
  c.segments[1].corner = false; // vertex at (99, 0)
  const r = layout.layoutContour(c, settings, { isOutline: true });
  assert.ok(!hasPoint(r.holes, 95, 4, 0.01));
  // The section from (4,4) to (95,46) runs round the corner at exactly
  // 4 mm: 133 mm leaves a 1 mm gap at the far corner.
  assert.ok(!hasPoint(r.holes, 95, 46));
  const L = 91 + 42;
  const sec = r.sections.find((s) => near(s.length, L));
  assert.ok(sec, 'merged section');
  assert.ok(sec.dropped);
  assert.ok(near(sec.gap, 1));
});

test('only selected edges get holes; open ends keep the exact spacing', () => {
  const c = model.rectangle(98, 50);
  c.segments[0].mode = 'holes'; // bottom edge only
  const r = layout.layoutContour(c, settings, { isOutline: true });
  assert.ok(r.holes.every((p) => near(p.y, 4)));
  // Starts at the corner, then exactly 4 mm apart, carrying on past the
  // usual edge distance up to the edge without holes (hole at 96 still
  // leaves 1 mm of leather before x = 98).
  const xs = r.holes.map((p) => p.x).sort((a, b) => a - b);
  assert.ok(near(xs[0], 4));
  gaps(r.holes.slice().sort((a, b) => a.x - b.x)).forEach((g) => assert.ok(near(g, 4)));
  assert.ok(near(xs[xs.length - 1], 96));
  assert.ok(!r.openEnds[0].conflict);
  // Start corner hole off: the pattern starts half a spacing in.
  c.segments[0].corner = false;
  const r2 = layout.layoutContour(c, settings, { isOutline: true });
  const xs2 = r2.holes.map((p) => p.x).sort((a, b) => a - b);
  assert.ok(near(xs2[0], 6));
  assert.ok(near(xs2[xs2.length - 1], 94));
  assert.ok(r2.openEnds[0].conflict); // the next one, at 98, sits on the edge
});

test('open ends run on from the origin at exact spacing', () => {
  const c = model.rectangle(100, 50);
  c.segments[0].mode = 'holes';
  const r = layout.layoutContour(c, settings, { isOutline: true, origin: { x: 50.5, y: 0 } });
  const xs = r.holes.map((p) => p.x).sort((a, b) => a - b);
  assert.ok(xs.some((x) => near(x, 50.5)));
  assert.ok(near(xs[0], 2.5));
  assert.ok(near(xs[xs.length - 1], 98.5));
  gaps(r.holes.slice().sort((a, b) => a.x - b.x)).forEach((g) => assert.ok(near(g, 4)));
  // Both ends are free, neither cuts a hole here.
  assert.equal(r.openEnds.length, 2);
  assert.ok(r.openEnds.every((e) => !e.conflict));
});

test('an edge without holes that crosses the next hole is flagged', () => {
  const c = model.rectangle(100, 50);
  c.segments[0].mode = 'holes';
  const r = layout.layoutContour(c, settings, { isOutline: true });
  // The pattern start is pinned, so only the far end is checked.
  assert.equal(r.openEnds.length, 1);
  const e = r.openEnds[0];
  assert.equal(e.which, 'end');
  assert.ok(e.conflict); // next hole would be at x = 100, on the edge
  assert.ok(hasPoint([e.holePt], 100, 4, 1e-6));
  // Nearest clear spots: the hole plus 0.5 mm of leather, either side.
  assert.deepEqual(e.targets.map((t) => Math.round(t * 100) / 100).sort(), [94.49, 97.51]);
});

test('circle: holes evenly spaced on the inset circle', () => {
  const c = model.circle(30, 0, 0, 'holes');
  const r = layout.layoutContour(c, settings, { isOutline: true });
  const n = Math.round((2 * Math.PI * 26) / 4);
  assert.equal(r.holes.length, n);
  r.holes.forEach((p) => assert.ok(near(Math.hypot(p.x, p.y), 26)));
});

test('rounded corners: holes follow the curve, no forced corner hole', () => {
  const c = model.rectangle(100, 50, 10, 0, 0, 'holes');
  const r = layout.layoutContour(c, settings, { isOutline: true });
  // Offset path is a rounded rectangle with radius 6; one closed run, no anchors.
  assert.equal(r.holePaths.length, 1);
  const L = 2 * (92 - 12) + 2 * (42 - 12) + 2 * Math.PI * 6;
  assert.ok(near(G.pathLength(r.holePaths[0].prims), L, 1e-6));
  // Exactly 4 mm all the way round, with whatever is left over as one
  // short gap.
  assert.equal(r.holes.length, Math.ceil(L / 4));
  assert.equal(r.sections.filter((s) => s.uneven).length, L % 4 > 0.01 ? 1 : 0);
  // Corner region is cut off: nothing at the raw offset corner.
  assert.ok(!hasPoint(r.holes, 4, 4, 0.5));
});

test('cutout holes go outside the cutout', () => {
  const c = model.rectangle(20, 10, 0, 40, 20, 'holes');
  const r = layout.layoutContour(c, { ...settings, spacing: 2 }, { isOutline: false });
  assert.ok(hasPoint(r.holes, 36, 16));
  assert.ok(hasPoint(r.holes, 64, 34));
});

test('origin point adds an anchor so mating pieces line up', () => {
  const c = model.rectangle(100, 50, 0, 0, 0, 'none');
  c.segments[0].mode = 'holes';
  c.segments[0].corner = false;
  c.segments[1].corner = false;
  // Clicked near the hole line: snaps onto it.
  const r = layout.layoutContour(c, settings, { isOutline: true, origin: { x: 30, y: 5 } });
  assert.ok(hasPoint(r.holes, 30, 4));
  assert.equal(r.origin.kind, 'hole');
});

test('origin on a stitch line is marked with a tick position', () => {
  const c = model.rectangle(100, 50, 0, 0, 0, 'stitch');
  const r = layout.layoutContour(c, settings, { isOutline: true, origin: { x: 40, y: 3 } });
  assert.equal(r.origin.kind, 'stitch');
  assert.ok(near(r.origin.pt.x, 40) && near(r.origin.pt.y, 4));
  assert.ok(near(Math.abs(r.origin.tangent.x), 1, 1e-6));
});

test('stitch line is offset from the edge', () => {
  const c = model.rectangle(100, 50, 0, 0, 0, 'stitch');
  const r = layout.layoutContour(c, settings, { isOutline: true });
  assert.equal(r.stitch.length, 1);
  const b = G.bbox(r.stitch[0].prims);
  assert.ok(near(b.minX, 4) && near(b.maxX, 96) && near(b.minY, 4) && near(b.maxY, 46));
});

test('mixed modes: holes on one edge, stitch on another', () => {
  const c = model.rectangle(100, 50);
  c.segments[0].mode = 'holes';
  c.segments[2].mode = 'stitch';
  const r = layout.layoutContour(c, settings, { isOutline: true });
  assert.ok(r.holes.length > 0 && r.holes.every((p) => near(p.y, 4)));
  assert.equal(r.stitch.length, 1);
  const s = r.stitch[0].prims[0];
  assert.ok(near(s.a.y, 46) && near(s.b.y, 46));
});

test('fillet larger than the offset leaves a smaller rounded path; smaller one collapses to a corner', () => {
  const small = model.rectangle(100, 52, 2, 0, 0, 'holes');
  const r = layout.layoutContour(small, settings, { isOutline: true });
  // fillet 2 < offset 4: offset corner is sharp again, so it gets a hole.
  assert.ok(hasPoint(r.holes, 4, 4, 1e-6));
});

test('triangle with a concave notch', () => {
  // An L shape: concave corner must still be a corner hole.
  const c = model.newContour();
  c.start = { x: 0, y: 0 };
  const L = (length, angle) => model.seg('line', { length, angle, mode: 'holes' });
  c.segments = [L(60, 0), L(20, 90), L(30, 180), L(30, 90), L(30, 180)];
  c.closing.mode = 'holes';
  const r = layout.layoutContour(c, { ...settings, spacing: 2 }, { isOutline: true });
  // Concave corner at (30, 20): offset point is (26, 16).
  assert.ok(hasPoint(r.holes, 26, 16));
  assert.ok(hasPoint(r.holes, 4, 46));
});
