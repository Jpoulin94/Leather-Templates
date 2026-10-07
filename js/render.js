// Turns laid-out geometry into SVG path data and builds the laser-cutting
// SVG export.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  const n = (v) => String(Number(v.toFixed(4)));

  // Split an arc into chunks of at most 90 degrees: [{a0, a1}] in radians.
  function arcChunks(p) {
    const k = Math.max(1, Math.ceil(Math.abs(p.sweep) / (Math.PI / 2) - 1e-9));
    const out = [];
    for (let i = 0; i < k; i++) out.push({ a0: p.a0 + (p.sweep * i) / k, a1: p.a0 + (p.sweep * (i + 1)) / k });
    return out;
  }

  // SVG path data for a list of primitives. `tx` maps a world point (y-up)
  // to an output point (y-down); arcs flip direction accordingly.
  function pathData(prims, tx, closed) {
    let d = '';
    let cur = null;
    let first = null;
    prims.forEach((p) => {
      const s = G.primStart(p);
      if (!cur || G.dist(cur, s) > 1e-6) {
        const t = tx(s);
        d += `M${n(t.x)} ${n(t.y)}`;
        if (!first) first = s;
      }
      if (p.type === 'line') {
        const t = tx(p.b);
        d += `L${n(t.x)} ${n(t.y)}`;
      } else {
        const flag = p.sweep > 0 ? 0 : 1;
        arcChunks(p).forEach((c) => {
          const t = tx(G.arcPoint(p.c, p.r, c.a1));
          d += `A${n(p.r)} ${n(p.r)} 0 0 ${flag} ${n(t.x)} ${n(t.y)}`;
        });
      }
      cur = G.primEnd(p);
    });
    if (closed && first && cur && G.dist(cur, first) < 1e-6) d += 'Z';
    return d;
  }

  // Laser SVG: every selected piece side by side, true size in mm.
  // Red = cut (outline, cutouts, holes); blue = score/engrave (stitch lines).
  function buildSvg(project, pieces) {
    const gap = 10;
    let x = gap;
    let height = 0;
    const parts = [];
    pieces.forEach((piece, i) => {
      const lay = LT.layout.layoutPiece(project, piece);
      const b = LT.layout.pieceBBox(lay);
      if (!b) return;
      const ox = x - b.minX;
      const tx = (p) => ({ x: p.x + ox, y: b.maxY - p.y + gap });
      const cut = [];
      const score = [];
      LT.layout.allOf(lay).forEach((c) => {
        // Stitch paths cut nothing: only their holes and stitching go out.
        if (c.kind !== 'path') cut.push(`<path d="${pathData(c.prims, tx, true)}"/>`);
        c.holes.forEach((h) => {
          const t = tx(h);
          cut.push(`<circle cx="${n(t.x)}" cy="${n(t.y)}" r="${n(lay.holeRadius)}"/>`);
        });
        c.stitch.forEach((s) => score.push(`<path d="${pathData(s.prims, tx, s.closed)}"/>`));
        (c.origins || []).forEach((o) => {
          if (o.kind === 'stitch') score.push(`<path d="${pathData([LT.layout.originTick(o)], tx, false)}"/>`);
        });
      });
      const id = `piece${i + 1}-${String(piece.name).replace(/[^A-Za-z0-9_-]+/g, '-')}`;
      parts.push(
        `<g id="${id}"><title>${escapeXml(piece.name)}</title>` +
          `<g id="${id}-cut" stroke="#FF0000">${cut.join('')}</g>` +
          (score.length ? `<g id="${id}-score" stroke="#0000FF">${score.join('')}</g>` : '') +
          `</g>`
      );
      x += b.maxX - b.minX + gap;
      height = Math.max(height, b.maxY - b.minY + 2 * gap);
    });
    const W = n(Math.max(x, 1));
    const H = n(Math.max(height, 1));
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n` +
      `<title>${escapeXml(project.name)}</title>\n` +
      `<g fill="none" stroke-width="0.1">\n${parts.join('\n')}\n</g>\n</svg>\n`
    );
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
  }

  LT.render = { arcChunks, pathData, buildSvg, escapeXml };
})(typeof window !== 'undefined' ? window : globalThis);
