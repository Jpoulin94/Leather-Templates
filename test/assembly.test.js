const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./load');
const { model, geom: G, assembly: A } = LT;

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function project(...pieces) {
  const p = model.newProject();
  p.pieces = pieces;
  return p;
}

test('pieces line up by their origin points', () => {
  const back = model.newPiece('Back', model.rectangle(100, 60, 0, 0, 0, 'holes'));
  const pocket = model.newPiece('Pocket', model.rectangle(100, 40, 0, 500, 500, 'holes'));
  back.outline.origin = { x: 5, y: 5 };
  pocket.outline.origin = { x: 505, y: 505 };
  const asm = A.buildAssembly(project(back, pocket));
  const [b, k] = asm.shown;
  assert.ok(G.dist(b.origin, k.origin) < 1e-6);
  // The pocket's bottom-left corner lands on the back's.
  const bb = G.bbox(b.outline);
  const kb = G.bbox(k.outline);
  assert.ok(near(bb.minX, kb.minX, 1e-6) && near(bb.minY, kb.minY, 1e-6));
});

test('holes that share a stitch are checked against each other', () => {
  const back = model.newPiece('Back', model.rectangle(100, 60, 0, 0, 0, 'holes'));
  const pocket = model.newPiece('Pocket', model.rectangle(100, 40, 0, 0, 0, 'holes'));
  // No holes along the pocket's top edge (edge 2), as on a real pocket.
  pocket.outline.segments[2].mode = 'none';
  back.outline.origin = { x: 5, y: 5 };
  pocket.outline.origin = { x: 5, y: 5 };
  let asm = A.buildAssembly(project(back, pocket));
  const onBack = asm.check.pairs.find((p) => p.a.piece === pocket && p.b.piece === back);
  // Bottom and side holes of the pocket match the back's; the corner
  // holes at the pocket's top sit on the back's sides too.
  assert.ok(onBack.matched > 0);
  assert.equal(onBack.missed, asm.check.bad.filter((x) => x.item.piece === pocket).length);
  // Shift the pocket half a spacing: its holes no longer line up.
  const proj = project(back, pocket);
  proj.assembly = { pieces: { [pocket.id]: { dx: 2 } } };
  asm = A.buildAssembly(proj);
  assert.ok(asm.check.bad.some((x) => x.item.piece === pocket));
});

test('turning a piece over and rotating it keeps its size', () => {
  const pc = model.newPiece('Strap', model.rectangle(80, 20, 5, 0, 0, 'holes'));
  const proj = project(pc);
  proj.assembly = { pieces: { [pc.id]: { flip: true, rot: 90 } } };
  const it = A.buildAssembly(proj).shown[0];
  const b = G.bbox(it.outline);
  assert.ok(near(b.maxX - b.minX, 20, 1e-6) && near(b.maxY - b.minY, 80, 1e-6));
  assert.ok(near(Math.abs(G.signedArea(it.outline)), 1600 - (4 - Math.PI) * 25, 1e-6));
});

test('pieces can be left out of the stack', () => {
  const a = model.newPiece('A');
  const b = model.newPiece('B');
  const proj = project(a, b);
  proj.assembly = { pieces: { [b.id]: { on: false } } };
  const asm = A.buildAssembly(proj);
  assert.equal(asm.items.length, 2);
  assert.equal(asm.shown.length, 1);
});
