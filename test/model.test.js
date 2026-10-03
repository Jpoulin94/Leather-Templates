const test = require('node:test');
const assert = require('node:assert/strict');
const { model } = require('./load');

test('parseLength handles decimals, fractions and unit suffixes', () => {
  assert.equal(model.parseLength('12.5', 'mm'), 12.5);
  assert.equal(model.parseLength('1', 'in'), 25.4);
  assert.equal(model.parseLength('3/16', 'in'), 25.4 * 3 / 16);
  assert.equal(model.parseLength('1 1/2', 'in'), 25.4 * 1.5);
  assert.equal(model.parseLength('1-1/2', 'in'), 25.4 * 1.5);
  assert.equal(model.parseLength('10mm', 'in'), 10);
  assert.equal(model.parseLength('2"', 'mm'), 50.8);
  assert.ok(Number.isNaN(model.parseLength('abc', 'mm')));
  assert.ok(Number.isNaN(model.parseLength('', 'mm')));
});

test('format converts to display units', () => {
  assert.equal(model.format(25.4, 'in'), '1');
  assert.equal(model.format(3.175, 'in'), '0.125');
  assert.equal(model.format(12.345, 'mm'), '12.35');
});

test('normalizeProject fills in defaults and rejects junk', () => {
  const p = model.normalizeProject({ name: 'x', pieces: [{ name: 'a', outline: { start: { x: 0, y: 0 }, segments: [] } }] });
  assert.equal(p.units, 'mm');
  assert.equal(p.pieces[0].cutouts.length, 0);
  assert.ok(p.pieces[0].outline.closing);
  assert.throws(() => model.normalizeProject({ foo: 1 }));
});
