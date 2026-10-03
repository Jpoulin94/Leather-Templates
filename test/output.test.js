const test = require('node:test');
const assert = require('node:assert/strict');
const LT = require('./load');
const { model, pdf, render } = LT;

function project() {
  const p = model.newProject('Test wallet');
  p.pieces[0].cutouts.push(model.rectangle(20, 10, 2, 40, 20, 'none'));
  const big = model.newPiece('Big strap', model.rectangle(400, 300, 5, 0, 0, 'stitch'));
  p.pieces.push(big);
  return p;
}

test('PDF has a valid structure and cross-reference table', () => {
  const p = project();
  const out = pdf.buildPdf(p, p.pieces, 'letter');
  assert.ok(out.startsWith('%PDF-1.4'));
  assert.ok(out.trimEnd().endsWith('%%EOF'));
  // Every xref offset points at "N 0 obj".
  const xrefPos = Number(out.match(/startxref\n(\d+)/)[1]);
  assert.ok(out.slice(xrefPos).startsWith('xref'));
  const rows = out.slice(xrefPos).split('\n').slice(3).filter((l) => / n $/.test(l));
  rows.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.ok(out.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`);
  });
  // Stream lengths are right.
  for (const m of out.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(out.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream');
  }
  // Small piece fits one page; 400x300 mm on Letter tiles 3 x 2.
  const count = Number(out.match(/\/Count (\d+)/)[1]);
  assert.equal(count, 1 + 6);
  assert.ok(/[\x00-\x7f]*/.test(out));
});

test('PDF draws at true scale: a 100 mm line is 283.46 pt', () => {
  const p = model.newProject('Scale');
  p.pieces[0].outline = model.rectangle(100, 60, 0, 0, 0, 'none');
  const out = pdf.buildPdf(p, p.pieces, 'a4');
  // Outline path: first move and first line along the bottom edge.
  const m = out.match(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l/);
  const dx = Number(m[3]) - Number(m[1]);
  assert.ok(Math.abs(dx - (100 * 72) / 25.4) < 0.01, `dx=${dx}`);
});

test('SVG export uses mm units and separates cut and score layers', () => {
  const p = project();
  p.pieces[1].outline.segments[0].mode = 'holes';
  const svg = render.buildSvg(p, p.pieces);
  assert.match(svg, /width="[\d.]+mm" height="[\d.]+mm"/);
  assert.match(svg, /stroke="#FF0000"/);
  assert.match(svg, /stroke="#0000FF"/);
  assert.match(svg, /<circle [^>]*r="1"/);
  assert.ok(!svg.includes('NaN'));
});
