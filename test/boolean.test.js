const test = require('node:test');
const assert = require('node:assert/strict');
const { model: M, boolean: B, geom: G } = require('./load');

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const area = (c) => G.signedArea(G.buildPrimitives(c));
const bb = (c) => G.bbox(G.buildPrimitives(c));

test('cut: circle centred on the top edge makes a half-circle thumb notch', () => {
  const pocket = M.rectangle(95, 60, 0, 0, 0, 'holes');
  const circle = M.circle(10, 47.5, 60);
  const r = B.combine(pocket, circle, 'cut');
  assert.ok(r.outline);
  assert.equal(r.holes.length, 0);
  assert.equal(r.open, 0);
  assert.ok(near(area(r.outline), 95 * 60 - (Math.PI * 100) / 2, 1e-3));
  // Edges: bottom, right, top-right, notch arc, top-left, left = 6
  assert.equal(r.outline.segments.length, 6);
  assert.equal(r.outline.segments.filter((s) => s.type === 'arc').length, 1);
  // Original edges keep their modes; the notch takes the circle's (none).
  assert.equal(r.outline.segments.find((s) => s.type === 'arc').mode, 'none');
  assert.ok(r.outline.segments.filter((s) => s.type === 'line').every((s) => s.mode === 'holes'));
  // No implicit closing edge
  assert.equal(G.closingEdge(r.outline), null);
});

test('merge: two overlapping rectangles become one L-free outline', () => {
  const a = M.rectangle(100, 50);
  const b = M.rectangle(40, 80, 0, 30, 0);
  const r = B.combine(a, b, 'merge');
  assert.ok(near(area(r.outline), 100 * 50 + 40 * 30, 1e-6));
  const box = bb(r.outline);
  assert.ok(near(box.maxY, 80) && near(box.maxX, 100));
});

test('merge with a shared edge removes the shared line', () => {
  const a = M.rectangle(50, 50);
  const b = M.rectangle(50, 50, 0, 50, 0);
  const r = B.combine(a, b, 'merge');
  assert.ok(near(area(r.outline), 5000, 1e-6));
  assert.equal(r.outline.segments.length, 4);
});

test('overlap keeps only the shared area', () => {
  const a = M.rectangle(100, 50);
  const b = M.circle(20, 100, 25);
  const r = B.combine(a, b, 'overlap');
  assert.ok(near(area(r.outline), (Math.PI * 400) / 2, 1e-3));
});

test('cut with a shape fully inside leaves it as a cutout', () => {
  const a = M.rectangle(100, 50);
  const b = M.circle(10, 50, 25);
  const r = B.combine(a, b, 'cut');
  assert.equal(r.holes.length, 1);
  assert.ok(near(Math.abs(area(r.holes[0])), Math.PI * 100, 1e-3));
});

test('cut across a rounded corner keeps the fillet as an arc', () => {
  const a = M.rectangle(100, 50, 10);
  const b = M.rectangle(30, 20, 0, 40, 40);
  const r = B.combine(a, b, 'cut');
  assert.ok(r.outline);
  assert.equal(r.outline.segments.filter((s) => s.type === 'arc').length, 4);
});

test('manual piece choice traces kept pieces either direction', () => {
  const a = M.rectangle(95, 60);
  const c = M.circle(10, 47.5, 60);
  const pieces = B.preset(B.splitShapes(G.buildPrimitives(a), G.buildPrimitives(c)), 'merge');
  // Manually: same as cut but chosen by hand (keep A outside, B inside).
  pieces.forEach((p) => {
    p.keep = p.from === 'A' ? p.where === 'out' : p.where === 'in';
  });
  const r = B.combine(a, c, null, pieces);
  assert.ok(r.outline);
  assert.ok(near(area(r.outline), 95 * 60 - (Math.PI * 100) / 2, 1e-3));
});
