const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./load');
const { model, clearance, layout } = LT;

const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

function bottomHoles(w) {
  const pr = model.newProject();
  const pc = pr.pieces[0];
  pc.outline = model.rectangle(w, 50);
  pc.outline.segments[0].mode = 'holes';
  return { pr, pc };
}

test('suggests sliding the side edge clear of the hole, nearest first', () => {
  const { pr, pc } = bottomHoles(100);
  const list = clearance.check(pr, pc);
  assert.equal(list.length, 1);
  const e = list[0];
  assert.equal(e.cutRef, 'o:1');
  assert.ok(e.movable);
  assert.equal(e.fixes.length, 2);
  assert.ok(e.fixes.some((d) => near(d, 1.51)));
  assert.ok(e.fixes.some((d) => near(d, -1.51)));
});

test('applying a suggestion moves only that edge and clears the flag', () => {
  const { pr, pc } = bottomHoles(100);
  const e = clearance.check(pr, pc)[0];
  assert.ok(clearance.moveEnd(pc, e, -1.51));
  const lens = pc.outline.segments.map((s) => s.length);
  assert.ok(near(lens[0], 98.49));
  assert.ok(near(lens[1], 50));
  assert.equal(clearance.check(pr, pc).length, 0);
  // The holes themselves did not move; the last one stays at x = 96.
  const xs = layout.layoutPiece(pr, pc).outline.holes.map((p) => p.x).sort((a, b) => a - b);
  assert.ok(near(xs[0], 4));
  assert.ok(near(xs[xs.length - 1], 96));
  // Or longer: the hole at x = 100 now fits.
  const { pc: pc2 } = bottomHoles(100);
  clearance.moveEnd(pc2, e, 1.51);
  assert.equal(clearance.check(pr, pc2).length, 0);
  assert.equal(layout.layoutPiece(pr, pc2).outline.holes.length, 25);
});

test('stacked pieces with open tops share every hole', () => {
  const pr = model.newProject();
  const mk = (name, h) => {
    const p = model.newPiece(name, model.rectangle(100, h, 0, 0, 0, 'holes'));
    p.outline.segments[2].mode = 'none';
    p.outline.origin = { x: 4, y: 4 };
    return p;
  };
  pr.pieces = [mk('Back', 70), mk('Pocket', 46)];
  assert.equal(LT.assembly.buildAssembly(pr).check.bad.length, 0);
  assert.equal(clearance.check(pr, pr.pieces[1]).length, 0);
  // At 45 mm the pocket's top would cut the hole at 44 on both sides.
  pr.pieces[1] = mk('Pocket', 45);
  const list = clearance.check(pr, pr.pieces[1]);
  assert.equal(list.length, 2);
  clearance.moveEnd(pr.pieces[1], list[0], list[0].fixes[0]);
  assert.equal(clearance.check(pr, pr.pieces[1]).length, 0);
  assert.equal(LT.assembly.buildAssembly(pr).check.bad.length, 0);
});

test('a slanted line end slides along the holed edge', () => {
  const { pr, pc } = bottomHoles(100);
  const ln = model.newLine({ x: 90, y: -5 }, { x: 70, y: 60 }, 'outline');
  ln.remove = 'right';
  pc.lines = [ln];
  const list = clearance.check(pr, pc);
  assert.equal(list.length, 1);
  assert.equal(list[0].cutRef, `l:${ln.id}`);
  assert.equal(list[0].fixes.length, 2);
  list[0].fixes.forEach((d) => {
    const copy = JSON.parse(JSON.stringify(pc));
    clearance.moveEnd(copy, list[0], d);
    assert.equal(clearance.check(pr, copy).length, 0);
  });
});

test('notch edges are flagged but not moved automatically', () => {
  assert.ok(!clearance.movable('n:abc'));
  assert.ok(!clearance.movable('j:a:o:1>c:b:2'));
  assert.ok(clearance.movable('o:3'));
  assert.ok(clearance.movable('c:x1:0'));
});
