const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./load');
const { model, layout, clearance, assembly, geom: G } = LT;

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const hasPoint = (pts, x, y, tol = 1e-6) => pts.some((p) => near(p.x, x, tol) && near(p.y, y, tol));

function project(spacing = 3) {
  const pr = model.newProject();
  pr.defaults.spacing = spacing;
  return pr;
}

test('stitch path: holes sit on the line, a hole on each bend and end', () => {
  const pr = project();
  const pc = pr.pieces[0];
  pc.paths = [model.newPath([{ x: 10, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 50 }])];
  const lc = layout.layoutPiece(pr, pc).paths[0];
  assert.ok(hasPoint(lc.holes, 10, 30));
  assert.ok(hasPoint(lc.holes, 40, 30));
  assert.ok(hasPoint(lc.holes, 40, 50));
  // 30 mm leg: 10 spaces exactly. 20 mm leg: 6 spaces and a 2 mm short gap.
  assert.equal(lc.holes.filter((h) => near(h.y, 30)).length, 11);
  const legs = lc.sections.filter((s) => s.uneven);
  assert.equal(legs.length, 1);
  assert.ok(near(legs[0].gap, 2));
  // Nothing is cut: the piece outline is unchanged.
  assert.equal(layout.layoutPiece(pr, pc).outline.prims.length, 4);
});

test('stitch path: the fix moves the end point to a whole number of spaces', () => {
  const pr = project();
  const pc = pr.pieces[0];
  pc.paths = [model.newPath([{ x: 10, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 50 }])];
  const u = clearance.uneven(pr, pc).find((x) => x.isPath);
  assert.deepEqual(u.fix.outline.map((f) => f.amount).sort((a, b) => a - b), [-2, 1]);
  clearance.applyFix(pc, u, 'point', 1);
  assert.ok(near(pc.paths[0].points[2].y, 51));
  assert.equal(clearance.uneven(pr, pc).filter((x) => x.isPath).length, 0);
});

test('an origin on a path spaces exactly from it and frees the ends', () => {
  const pr = project();
  const pc = pr.pieces[0];
  const pth = model.newPath([{ x: 10, y: 30 }, { x: 30, y: 30 }]);
  pth.origins = [{ id: 'b', name: 'B', x: 21, y: 30 }];
  pc.paths = [pth];
  const lc = layout.layoutPiece(pr, pc).paths[0];
  const xs = lc.holes.map((h) => h.x).sort((a, b) => a - b);
  assert.ok(near(xs[0], 12));
  assert.ok(near(xs[xs.length - 1], 30));
  assert.equal(lc.origins[0].name, 'B');
});

test('uneven side: fixes by outline or by the next edge’s distance', () => {
  const pr = project();
  const pc = pr.pieces[0];
  pc.outline = model.rectangle(100, 60, 0, 0, 0, 'holes');
  const list = clearance.uneven(pr, pc);
  // 92 mm and 52 mm between corner holes at 3 mm: all four sides are uneven.
  assert.equal(list.length, 4);
  const bottom = list.find((u) => u.own && u.own.ref === 'o:0');
  assert.ok(near(bottom.gap, 2));
  assert.deepEqual(bottom.fix.outline.map((f) => f.amount).sort((a, b) => a - b), [-2, 1]);
  const d = bottom.fix.distance.map((f) => [f.amount, f.closer]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(d, [[2, true], [5, false]]);
  // Holes 5 mm from the right edge: 100 - 4 - 6 = 90 mm, 30 spaces.
  clearance.applyFix(pc, bottom, 'distance', 5);
  assert.equal(pc.outline.segments[1].edgeDist, 5);
  const after = clearance.uneven(pr, pc);
  assert.ok(!after.some((u) => u.own && (u.own.ref === 'o:0' || u.own.ref === 'o:2')));
  // The right edge's holes moved in to 6 mm from the edge.
  const holes = layout.layoutPiece(pr, pc).outline.holes;
  assert.ok(hasPoint(holes, 94, 30, 1e-6) || holes.some((h) => near(h.x, 94)));
});

test('several named origins on one row: exact from each, short gap between', () => {
  const settings = { holeDiameter: 2, spacing: 4, edgeDistance: 3, stitchOffset: 4 };
  const c = model.rectangle(100, 50);
  c.segments[0].mode = 'holes';
  const r = layout.layoutContour(c, settings, { isOutline: true, origins: [{ id: 'a', name: 'A', x: 20, y: 0 }, { id: 'b', name: 'B', x: 50, y: 0 }] });
  assert.ok(hasPoint(r.holes, 20, 4));
  assert.ok(hasPoint(r.holes, 50, 4));
  assert.deepEqual(r.origins.map((o) => o.name), ['A', 'B']);
  const between = r.sections.find((s) => s.uneven);
  assert.ok(between && near(between.length, 30) && near(between.gap, 2));
});

test('origin names: next free letter, and old single origins get one', () => {
  const pc = model.newPiece('P');
  assert.equal(model.nextOriginName(pc), 'A');
  pc.outline.origins = [{ id: '1', name: 'A', x: 0, y: 0 }];
  pc.paths = [{ ...model.newPath([{ x: 0, y: 0 }, { x: 1, y: 0 }]), origins: [{ id: '2', name: 'B', x: 0, y: 0 }] }];
  assert.equal(model.nextOriginName(pc), 'C');
  const p = model.normalizeProject({ pieces: [{ name: 'X', outline: { ...model.rectangle(10, 10), origin: { x: 1, y: 1 } }, cutouts: [{ ...model.rectangle(2, 2, 0, 3, 3), origin: { x: 3, y: 3 } }] }] });
  const names = model.pieceOrigins(p.pieces[0]).map((x) => x.o.name);
  assert.deepEqual(names, ['A', 'B']);
});

test('assemble: a piece lines up on the origin name it shares with one below', () => {
  const pr = project(4);
  const back = model.newPiece('Back', model.rectangle(100, 70, 0, 0, 0, 'holes'));
  back.outline.origins = [{ id: 'a', name: 'A', x: 4, y: 4 }];
  back.paths = [{ ...model.newPath([{ x: 30, y: 40 }, { x: 70, y: 40 }]), origins: [{ id: 'p', name: 'Pocket', x: 30, y: 40 }] }];
  const pocket = model.newPiece('Pocket', model.rectangle(40, 20, 0, 0, 0, 'holes'));
  pocket.outline.origins = [{ id: 'q', name: 'Pocket', x: 4, y: 4 }];
  pr.pieces = [back, pocket];
  const asm = assembly.buildAssembly(pr);
  const it = asm.items[1];
  assert.equal(it.pairedWith, 'Back');
  assert.equal(it.originName, 'Pocket');
  // The pocket's origin hole sits on the back's "Pocket" origin.
  const backPocket = asm.items[0].origins.find((o) => o.name === 'Pocket').pt;
  assert.ok(G.dist(it.origin, backPocket) < 1e-6);
});
