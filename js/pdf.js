// Printable PDF at true 1:1 scale, written directly (no library).
//
// Each piece gets its own page(s). A piece larger than the printable area is
// tiled across several pages: trim each page along the dashed border and
// butt the edges together, matching the crosshair marks. Every page has a
// scale-check square in the project's units.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  const PT = 72 / 25.4; // points per mm
  const PAPER = {
    letter: { w: 215.9, h: 279.4, label: 'Letter' },
    a4: { w: 210, h: 297, label: 'A4' },
  };
  const MARGIN = { left: 10, right: 10, top: 10, bottom: 34 };

  const f = (v) => String(Number(v.toFixed(3)));
  const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, '?').replace(/([()\\])/g, '\\$1');

  class Canvas {
    constructor() {
      this.ops = [];
    }
    mm(x, y) {
      return `${f(x * PT)} ${f(y * PT)}`;
    }
    push(s) {
      this.ops.push(s);
    }
    lineWidth(mm) {
      this.push(`${f(mm * PT)} w`);
    }
    gray(g) {
      this.push(`${g} G ${g} g`);
    }
    dash(onMm, offMm) {
      this.push(onMm ? `[${f(onMm * PT)} ${f(offMm * PT)}] 0 d` : '[] 0 d');
    }
    line(x1, y1, x2, y2) {
      this.push(`${this.mm(x1, y1)} m ${this.mm(x2, y2)} l S`);
    }
    rect(x, y, w, h) {
      this.push(`${this.mm(x, y)} ${f(w * PT)} ${f(h * PT)} re S`);
    }
    text(x, y, size, s) {
      this.push(`BT /F1 ${size} Tf ${this.mm(x, y)} Td (${ascii(s)}) Tj ET`);
    }
    // Primitives mapped through `map` (world mm -> page mm).
    prims(prims, map, close) {
      let cur = null;
      let first = null;
      const out = [];
      prims.forEach((p) => {
        const s = G.primStart(p);
        if (!cur || G.dist(cur, s) > 1e-6) {
          const t = map(s);
          out.push(`${this.mm(t.x, t.y)} m`);
          if (!first) first = s;
        }
        if (p.type === 'line') {
          const t = map(p.b);
          out.push(`${this.mm(t.x, t.y)} l`);
        } else {
          LT.render.arcChunks(p).forEach((c) => out.push(this.bezier(p.c, p.r, c.a0, c.a1, map)));
        }
        cur = G.primEnd(p);
      });
      if (close && first && cur && G.dist(first, cur) < 1e-6) out.push('h');
      out.push('S');
      this.push(out.join(' '));
    }
    bezier(c, r, a0, a1, map) {
      const k = (4 / 3) * Math.tan((a1 - a0) / 4);
      const p0 = G.arcPoint(c, r, a0);
      const p3 = G.arcPoint(c, r, a1);
      const p1 = { x: p0.x - k * r * Math.sin(a0), y: p0.y + k * r * Math.cos(a0) };
      const p2 = { x: p3.x + k * r * Math.sin(a1), y: p3.y - k * r * Math.cos(a1) };
      const [q1, q2, q3] = [p1, p2, p3].map(map);
      return `${this.mm(q1.x, q1.y)} ${this.mm(q2.x, q2.y)} ${this.mm(q3.x, q3.y)} c`;
    }
    circle(cx, cy, r) {
      const p = { type: 'arc', c: { x: cx, y: cy }, r, a0: 0, sweep: Math.PI * 2 };
      this.prims([p], (q) => q, true);
    }
    toString() {
      return this.ops.join('\n');
    }
  }

  function writePdf(pages) {
    // pages: [{ w, h (pt), content }]
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    const kids = [];
    pages.forEach((pg, i) => {
      const pageId = 4 + i * 2;
      const contentId = pageId + 1;
      kids.push(`${pageId} 0 R`);
      objs[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pg.w)} ${f(pg.h)}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
      objs[contentId] = `<< /Length ${pg.content.length} >>\nstream\n${pg.content}\nendstream`;
    });
    objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }

  function crosshair(cv, x, y) {
    cv.line(x - 4, y, x + 4, y);
    cv.line(x, y - 4, x, y + 4);
  }

  function settingsLine(project, s) {
    const u = project.units;
    const F = (v) => `${LT.model.format(v, u)} ${u}`;
    return `Holes ${F(s.holeDiameter)} dia, ${F(s.spacing)} spacing, ${F(s.edgeDistance)} from edge. Stitch line ${F(s.stitchOffset)} from edge.`;
  }

  // Returns the PDF file as a binary string (ASCII only).
  function buildPdf(project, pieces, paperKey = 'letter') {
    const paper = PAPER[paperKey] || PAPER.letter;
    const cw = paper.w - MARGIN.left - MARGIN.right;
    const ch = paper.h - MARGIN.top - MARGIN.bottom;
    const pages = [];

    pieces.forEach((piece) => {
      const lay = LT.layout.layoutPiece(project, piece);
      const b = LT.layout.pieceBBox(lay);
      if (!b) return;
      const bw = b.maxX - b.minX;
      const bh = b.maxY - b.minY;
      const cols = Math.max(1, Math.ceil(bw / cw - 1e-9));
      const rows = Math.max(1, Math.ceil(bh / ch - 1e-9));
      // Centre the piece within the whole tiled area.
      const x0 = b.minX - (cols * cw - bw) / 2;
      const yTop = b.maxY + (rows * ch - bh) / 2;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cv = new Canvas();
          const wx = x0 + c * cw; // world x at the left of this tile
          const wy = yTop - (r + 1) * ch; // world y at the bottom of this tile
          const map = (p) => ({ x: MARGIN.left + p.x - wx, y: MARGIN.bottom + p.y - wy });

          cv.push('q');
          cv.push(`${cv.mm(MARGIN.left, MARGIN.bottom)} ${f(cw * PT)} ${f(ch * PT)} re W n`);
          cv.gray(0);
          cv.dash(0);
          LT.layout.allOf(lay).forEach((ct) => {
            cv.lineWidth(0.3);
            if (ct.kind !== 'path') cv.prims(ct.prims, map, true);
            cv.lineWidth(0.2);
            cv.dash(1.5, 1);
            ct.stitch.forEach((s) => cv.prims(s.prims, map, s.closed));
            cv.dash(0);
            (ct.origins || []).forEach((o) => {
              // Origin: a tick across the stitch line, or a ring round the
              // hole, with its name.
              cv.lineWidth(0.3);
              const t = map(o.pt);
              if (o.kind === 'stitch') cv.prims([LT.layout.originTick(o)], map, false);
              else cv.circle(t.x, t.y, lay.holeRadius + 1);
              if (o.name) cv.text(t.x + lay.holeRadius + 1.5, t.y + 1, 7, o.name);
            });
            ct.holes.forEach((h) => {
              const t = map(h);
              cv.lineWidth(0.15);
              cv.circle(t.x, t.y, lay.holeRadius);
              const k = Math.min(0.5, lay.holeRadius * 0.6);
              cv.lineWidth(0.08);
              cv.line(t.x - k, t.y, t.x + k, t.y);
              cv.line(t.x, t.y - k, t.x, t.y + k);
            });
          });
          cv.push('Q');

          // Page furniture
          cv.gray(0.45);
          cv.lineWidth(0.15);
          if (rows * cols > 1) {
            cv.dash(2, 2);
            cv.rect(MARGIN.left, MARGIN.bottom, cw, ch);
            cv.dash(0);
            [
              [MARGIN.left, MARGIN.bottom],
              [MARGIN.left + cw, MARGIN.bottom],
              [MARGIN.left, MARGIN.bottom + ch],
              [MARGIN.left + cw, MARGIN.bottom + ch],
            ].forEach(([x, y]) => crosshair(cv, x, y));
          }
          cv.gray(0);
          const title =
            rows * cols > 1
              ? `${piece.name}  -  page row ${r + 1} of ${rows}, column ${c + 1} of ${cols}`
              : piece.name;
          cv.text(MARGIN.left, MARGIN.bottom - 8, 11, title);
          cv.text(MARGIN.left, MARGIN.bottom - 14, 7, `${project.name}  |  ${settingsLine(project, lay.settings)}`);
          cv.text(MARGIN.left, MARGIN.bottom - 19, 8, 'Print at 100% / "Actual size" (no scaling). Check the square before cutting.');
          if (rows * cols > 1) {
            cv.text(MARGIN.left, MARGIN.bottom - 24, 8, 'Trim on the dashed border and line up the + marks with the neighbouring pages.');
          }
          // Scale check square: 20 mm in either unit setting.
          const sq = 20;
          const sx = paper.w - MARGIN.right - sq;
          const sy = 4;
          cv.lineWidth(0.2);
          cv.rect(sx, sy, sq, sq);
          cv.text(sx + 2, sy + sq / 2 + 1, 7, 'Should be');
          cv.text(sx + 2, sy + sq / 2 - 3, 7, '20 mm');
          pages.push({ w: paper.w * PT, h: paper.h * PT, content: cv.toString() });
        }
      }
    });
    if (!pages.length) {
      const cv = new Canvas();
      cv.text(MARGIN.left, paper.h - 20, 12, 'Nothing to print.');
      pages.push({ w: paper.w * PT, h: paper.h * PT, content: cv.toString() });
    }
    return writePdf(pages);
  }

  LT.pdf = { PAPER, MARGIN, buildPdf, writePdf };
})(typeof window !== 'undefined' ? window : globalThis);
