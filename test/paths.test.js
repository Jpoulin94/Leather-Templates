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
  // Only ever longer.
  assert.deepEqual(u.fix.outline.map((f) => f.amount), [1]);
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

test('uneven side: remove the corner hole, make it longer, or a shorter distance for every edge', () => {
  const pr = project();
  const pc = pr.pieces[0];
  pc.outline = model.rectangle(100, 60, 0, 0, 0, 'holes');
  const list = clearance.uneven(pr, pc);
  // 92 mm and 52 mm between corner holes at 3 mm: all four sides are uneven.
  assert.equal(list.length, 4);
  const bottom = list.find((u) => u.own && u.own.ref === 'o:0');
  assert.ok(near(bottom.gap, 2));
  assert.equal(bottom.fix.remove, true);
  assert.deepEqual(bottom.fix.outline.map((f) => f.amount), [1]);
  // 2.5 mm from every edge makes the long sides 93 mm, but the short ones
  // 53 mm: no single distance fits both.
  assert.deepEqual(bottom.fix.distance.map((f) => [f.amount, f.left]), [[2.5, 2]]);
  // Make it longer: 101 mm wide, 93 mm between corner holes.
  const grown = JSON.parse(JSON.stringify(pc));
  clearance.applyFix(grown, bottom, 'outline', 1);
  assert.ok(!clearance.uneven(pr, grown).some((u) => u.own && (u.own.ref === 'o:0' || u.own.ref === 'o:2')));
});

test('removing the corner hole keeps every gap exact', () => {
  const pr = project();
  const pc = pr.pieces[0];
  pc.outline = model.rectangle(100, 60, 0, 0, 0, 'holes');
  const bottom = clearance.uneven(pr, pc).find((u) => u.own && u.own.ref === 'o:0');
  assert.ok(clearance.applyFix(pc, bottom, 'remove'));
  const lay = layout.layoutPiece(pr, pc);
  // The bottom-right corner hole (96, 4) is gone; the others stay.
  assert.ok(!hasPoint(lay.outline.holes, 96, 4, 1e-6));
  assert.ok(hasPoint(lay.outline.holes, 4, 4, 1e-6));
  assert.equal(lay.outline.removed.length, 1);
  assert.ok(!clearance.uneven(pr, pc).some((u) => u.id === bottom.id));
  // Along the bottom every gap is 3 mm.
  const xs = lay.outline.holes.filter((h) => near(h.y, 4)).map((h) => h.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(near(xs[i] - xs[i - 1], 3));
  // It survives a save and load.
  assert.deepEqual(model.normalizeProject(JSON.parse(JSON.stringify(pr))).pieces[0].skipHoles, pc.skipHoles);
});

test('a shorter distance from every edge that fits all sides', () => {
  const pr = project();
  const pc = pr.pieces[0];
  pc.outline = model.rectangle(99, 60, 0, 0, 0, 'holes');
  const u = clearance.uneven(pr, pc)[0];
  // 2 mm from the edge: 93 and 54 mm between corner holes.
  assert.deepEqual(u.fix.distance.map((f) => [f.amount, f.left]), [[2, 0]]);
  pr.defaults.edgeDistance = 2;
  assert.equal(clearance.uneven(pr, pc).length, 0);
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
