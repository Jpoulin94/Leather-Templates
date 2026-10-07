// Turns a piece's editable parts into the final shapes that get stitched,
// printed and cut. Notches and combined shapes stay "live": the piece keeps
// its base outline, its notches and its shapes, and this module rebuilds
// the result every time, so each part can still be edited later.
//
//   1. base outline edges
//   2. notches cut into straight outline edges
//   3. shapes set to cut away / merge / keep overlap, applied in order
//   4. shapes set to 'hole' stay separate cutouts
//
// Every resolved edge remembers where it came from (`ref`) and every vertex
// where its corner settings live (`vref`):
//   o:<edge>            base outline edge / vertex
//   c:<shape>:<edge>    edge / vertex of a shape
//   n:<notch>           notch edges;  n:<notch>:L / :R  its two mouth corners
//   j:<shape>:<in>><out> a corner made where a combined shape crosses
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  const NEAR = 1e-4;
  const OPS = ['cut', 'merge', 'overlap'];

  // Raw edges of a contour, tagged with source refs and vertex settings.
  function taggedEdges(contour, prefix) {
    return G.buildEdges(contour).map((e) => {
      const vp = G.vertexProps(contour, e.edge);
      const ref = `${prefix}${e.edge}`;
      return { ...e, ref, vref: ref, mode: vp.mode, fillet: vp.fillet, corner: vp.corner };
    });
  }

  // ---------------------------------------------------------------------
  // Notches

  // Notch outline relative to the edge: { segs: [{type,...}] } as turtle
  // segments starting at the notch's first mouth corner, heading h (deg),
  // with `s` = +1 when the material is to the left of the edge.
  function notchSegments(h, width, depth, s) {
    const w2 = width / 2;
    if (Math.abs(depth - w2) < 1e-6) {
      return [{ type: 'arc', radius: w2, sweep: -s * 180, angle: h + s * 90 }];
    }
    if (depth < w2) {
      const R = (w2 * w2 + depth * depth) / (2 * depth);
      const th = G.deg(Math.asin(Math.min(1, w2 / R)));
      return [{ type: 'arc', radius: R, sweep: -s * 2 * th, angle: h + s * th }];
    }
    const side = depth - w2;
    return [
      { type: 'line', length: side, angle: h + s * 90 },
      { type: 'arc', radius: w2, sweep: -s * 180, angle: h + s * 90 },
      { type: 'line', length: side, angle: h - s * 90 },
    ];
  }

  // Turtle segments to primitives, starting at p.
  function segsToPrims(start, segs) {
    let p = start;
    return segs.map((sg) => {
      const hd = G.rad(sg.angle);
      let prim;
      if (sg.type === 'arc') {
        const sw = G.rad(sg.sweep);
        const sgn = Math.sign(sw);
        const c = G.add(p, G.mul({ x: -Math.sin(hd), y: Math.cos(hd) }, sg.radius * sgn));
        prim = { type: 'arc', c, r: sg.radius, a0: Math.atan2(p.y - c.y, p.x - c.x), sweep: sw };
      } else {
        prim = { type: 'line', a: p, b: { x: p.x + sg.length * Math.cos(hd), y: p.y + sg.length * Math.sin(hd) } };
      }
      p = G.primEnd(prim);
      return prim;
    });
  }

  // Where a notch sits on its edge: { at, ok } (at = centre, mm from start).
  function notchPlace(notch, L) {
    const w = Number(notch.width) || 0;
    const d = Number(notch.depth) || 0;
    if (!(w > 0) || !(d > 0) || w > L - 1e-6) return { ok: false, at: L / 2 };
    let at = notch.at === null || notch.at === undefined ? L / 2 : Number(notch.at);
    at = Math.max(w / 2, Math.min(L - w / 2, at));
    return { ok: true, at };
  }

  function applyNotches(edges, notches, ccw, report) {
    if (!notches || !notches.length) return edges;
    const s = ccw ? 1 : -1;
    const out = [];
    edges.forEach((e) => {
      const mine = notches.filter((n) => n.edge === e.edge);
      if (!mine.length || e.type !== 'line') {
        mine.forEach((n) => (report[n.id] = { ok: false, reason: 'curve' }));
        out.push(e);
        return;
      }
      const L = G.dist(e.a, e.b);
      const u = G.norm(G.sub(e.b, e.a));
      const h = G.deg(Math.atan2(u.y, u.x));
      const at = (d) => G.add(e.a, G.mul(u, d));
      const placed = mine.map((n) => ({ n, ...notchPlace(n, L) })).sort((a, b) => a.at - b.at);
      let pos = 0;
      let startV = { vref: e.vref, fillet: e.fillet, corner: e.corner };
      placed.forEach(({ n, ok, at: c }) => {
        const w2 = (Number(n.width) || 0) / 2;
        if (!ok || c - w2 < pos - 1e-6) {
          report[n.id] = { ok: false, reason: ok ? 'overlap' : 'size', edgeLength: L };
          return;
        }
        report[n.id] = { ok: true, at: c, edgeLength: L };
        const P0 = at(c - w2);
        const P1 = at(c + w2);
        const vL = notchVertex(n, 'L');
        if (c - w2 - pos > 1e-6) {
          out.push({ type: 'line', a: at(pos), b: P0, ref: e.ref, mode: e.mode, ...startV });
          startV = vL;
        } else if (pos === 0) {
          // The notch starts right at the edge's corner: that corner wins.
        } else {
          startV = vL;
        }
        const prims = segsToPrims(P0, notchSegments(h, Number(n.width), Number(n.depth), s));
        prims.forEach((p, k) => {
          const v = k === 0 ? startV : { vref: `n:${n.id}:x`, fillet: 0, corner: true };
          out.push({ ...p, ref: `n:${n.id}`, mode: e.mode, ...v });
        });
        const last = out[out.length - 1];
        if (last.type === 'line') last.b = P1;
        pos = c + w2;
        startV = notchVertex(n, 'R');
      });
      if (L - pos > 1e-6) out.push({ type: 'line', a: at(pos), b: e.b, ref: e.ref, mode: e.mode, ...startV });
    });
    return out;
  }

  function notchVertex(n, side) {
    const cc = (n.corners && n.corners[side]) || {};
    return { vref: `n:${n.id}:${side}`, fillet: Number(cc.fillet) || 0, corner: cc.corner !== false };
  }

  // ---------------------------------------------------------------------
  // Combining

  function vertexTable(prims) {
    return prims.map((p) => ({ pt: G.primStart(p), vref: p.vref, fillet: p.fillet, corner: p.corner }));
  }

  function combineTagged(A, B, op, shape) {
    const B2 = LT.boolean;
    const pieces = B2.preset(B2.splitShapes(A, B), op);
    const { loops } = B2.trace(pieces, op);
    if (!loops.length) return null;
    const table = vertexTable(A).concat(vertexTable(B));
    const joins = shape.joins || {};
    const fixed = loops.map((loop) =>
      loop.map((p, i) => {
        const at = G.primStart(p);
        const hit = table.find((t) => G.dist(t.pt, at) < NEAR);
        if (hit) return { ...p, vref: hit.vref, fillet: hit.fillet, corner: hit.corner };
        const prev = loop[(i - 1 + loop.length) % loop.length];
        const key = `${prev.ref}>${p.ref}`;
        const j = joins[key] || {};
        return { ...p, vref: `j:${shape.id}:${key}`, fillet: Number(j.fillet) || 0, corner: j.corner !== false };
      })
    );
    const ccwLoops = fixed.map((l) => (G.signedArea(l) > 0 ? l : reverseTagged(l)));
    ccwLoops.sort((x, y) => G.signedArea(y) - G.signedArea(x));
    return ccwLoops;
  }

  // Reverse a tagged loop; each vertex's settings move with the point.
  function reverseTagged(loop) {
    const n = loop.length;
    return loop
      .slice()
      .reverse()
      .map((p, i) => {
        const r = LT.boolean.reversePrim(p);
        // The reversed prim starts where the original ended, i.e. at the
        // start of the next original prim.
        const next = loop[(n - i) % n];
        return { ...r, vref: next.vref, fillet: next.fillet, corner: next.corner };
      });
  }

  const inside = (poly, pt) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };

  // ---------------------------------------------------------------------
  // Back to an editable-looking contour (turtle segments) that keeps the
  // refs, so layout and fillets work unchanged.

  const norm360 = (d) => ((d % 360) + 360) % 360;

  function primsToContour(prims) {
    const segs = prims.map((p) => {
      const t = G.primStartTangent(p);
      const angle = norm360(G.deg(Math.atan2(t.y, t.x)));
      const common = { mode: p.mode || 'none', fillet: Number(p.fillet) || 0, corner: p.corner !== false, ref: p.ref, vref: p.vref };
      if (p.type === 'line') return { type: 'line', length: G.dist(p.a, p.b), angle, ...common };
      return { type: 'arc', radius: p.r, sweep: G.deg(p.sweep), angle, ...common };
    });
    const s = G.primStart(prims[0]);
    return { start: { x: s.x, y: s.y }, segments: segs, closing: { mode: 'none', fillet: 0, corner: true } };
  }

  // ---------------------------------------------------------------------

  function resolvePiece(piece) {
    const report = { notches: {}, shapes: {} };
    const base = piece.outline;
    const out = { outline: null, cutouts: [], report };
    let edges = taggedEdges(base, 'o:');
    if (!edges.length) {
      (piece.cutouts || []).forEach((c) => {
        if (!OPS.includes(c.op)) {
          const e = taggedEdges(c, `c:${c.id}:`);
          if (e.length) out.cutouts.push({ contour: primsToContour(e), src: c.id, origin: c.origin || null });
        }
      });
      return out;
    }
    const ccw = G.signedArea(edges) > 0;
    edges = applyNotches(edges, piece.notches, ccw, report.notches);

    let outer = edges;
    const derived = [];
    (piece.cutouts || []).forEach((shape) => {
      if (!OPS.includes(shape.op)) return;
      const B = taggedEdges(shape, `c:${shape.id}:`);
      if (!B.length) return;
      const loops = combineTagged(outer, B, shape.op, shape);
      if (!loops) {
        report.shapes[shape.id] = { ok: false, reason: 'none' };
        return;
      }
      if (shape.op === 'merge' && loops.length > 1) {
        const poly = G.samplePoints(loops[0], 64);
        const apart = loops.slice(1).some((l) => !inside(poly, G.primPointAt(l[0], G.primLength(l[0]) / 2)));
        if (apart) {
          report.shapes[shape.id] = { ok: false, reason: 'apart' };
          return;
        }
      }
      outer = loops[0];
      const poly = G.samplePoints(outer, 64);
      let extra = 0;
      loops.slice(1).forEach((l) => {
        if (inside(poly, G.primPointAt(l[0], G.primLength(l[0]) / 2))) derived.push(l);
        else extra++;
      });
      report.shapes[shape.id] = { ok: true, extra };
    });

    out.outline = primsToContour(outer);
    (piece.cutouts || []).forEach((c) => {
      if (OPS.includes(c.op)) return;
      const e = taggedEdges(c, `c:${c.id}:`);
      if (e.length) out.cutouts.push({ contour: primsToContour(e), src: c.id, origin: c.origin || null });
    });
    derived.forEach((l) => out.cutouts.push({ contour: primsToContour(l), src: null, origin: null }));
    return out;
  }

  // ---------------------------------------------------------------------
  // Resizing. Rather than scaling (which would change corner radii and hole
  // sizes), a resize stretches the shape: every corner on the far side of
  // the middle moves by the change in size, so straight edges get longer
  // and rounded corners keep their radius.

  const r4 = (v) => Math.round(v * 10000) / 10000;

  function isCircle(c) {
    return c.segments.length === 1 && c.segments[0].type === 'arc' && Math.abs(Math.abs(Number(c.segments[0].sweep)) - 360) < 1e-6;
  }

  function rawBox(c) {
    const e = G.buildEdges(c);
    return e.length ? G.bbox(e) : null;
  }

  // Rebuild a contour's segments after moving its corners with moveFn.
  function moveCorners(c, moveFn) {
    const edges = G.buildEdges(c);
    if (!edges.length) return;
    const pts = edges.map((e) => moveFn(G.primStart(e)));
    edges.forEach((e, k) => {
      if (e.closing) return;
      const sg = c.segments[e.edge];
      const p0 = pts[k];
      const p1 = pts[(k + 1) % edges.length];
      const d = G.sub(p1, p0);
      const chord = G.len(d);
      const chordAng = G.deg(Math.atan2(d.y, d.x));
      if (sg.type === 'arc') {
        const sw = Number(sg.sweep);
        if (chord < 1e-9) return;
        sg.radius = r4(chord / (2 * Math.sin(G.rad(Math.abs(sw)) / 2)));
        sg.angle = r4((((chordAng - sw / 2) % 360) + 360) % 360);
      } else {
        sg.length = r4(chord);
        sg.angle = r4(((chordAng % 360) + 360) % 360);
      }
    });
    c.start = { x: r4(pts[0].x), y: r4(pts[0].y) };
  }

  // Resize contour c to w x h. anchor 'topleft' keeps the left and top
  // edges where they are (a piece); 'centre' keeps the middle (a shape).
  // Returns the point mapping used, so related points can follow.
  function resizeContour(c, w, h, anchor) {
    const b = rawBox(c);
    if (!b) return (p) => p;
    const W = b.maxX - b.minX;
    const H = b.maxY - b.minY;
    const mx = (b.minX + b.maxX) / 2;
    const my = (b.minY + b.maxY) / 2;
    if (isCircle(c)) {
      const e = G.buildEdges(c)[0];
      const R = (Number.isFinite(w) && Math.abs(w - W) > 1e-9 ? w : h) / 2;
      const k = R / e.r;
      let ctr = e.c;
      if (anchor === 'topleft') ctr = { x: b.minX + R, y: b.maxY - R };
      const st = G.sub(c.start, e.c);
      c.segments[0].radius = r4(R);
      c.start = { x: r4(ctr.x + st.x * k), y: r4(ctr.y + st.y * k) };
      return (p) => ({ x: ctr.x + (p.x - e.c.x) * k, y: ctr.y + (p.y - e.c.y) * k });
    }
    const dx = Number.isFinite(w) ? w - W : 0;
    const dy = Number.isFinite(h) ? h - H : 0;
    const tol = 1e-6;
    const fn = anchor === 'topleft'
      ? (p) => ({ x: p.x + (p.x > mx + tol ? dx : 0), y: p.y + (p.y < my - tol ? -dy : 0) })
      : (p) => ({
          x: p.x + (p.x > mx + tol ? dx / 2 : p.x < mx - tol ? -dx / 2 : 0),
          y: p.y + (p.y > my + tol ? dy / 2 : p.y < my - tol ? -dy / 2 : 0),
        });
    moveCorners(c, fn);
    return fn;
  }

  // Resize a whole piece: the outline stretches, shapes keep their size and
  // move with the side they are nearest to (a centred shape stays centred),
  // and origin points move with them.
  function resizePiece(piece, w, h) {
    const b = rawBox(piece.outline);
    if (!b) return;
    const mx = (b.minX + b.maxX) / 2;
    const my = (b.minY + b.maxY) / 2;
    const W = b.maxX - b.minX;
    const H = b.maxY - b.minY;
    const fn = resizeContour(piece.outline, w, h, 'topleft');
    if (piece.outline.origin) piece.outline.origin = fn(piece.outline.origin);
    const nb = rawBox(piece.outline);
    const nmx = (nb.minX + nb.maxX) / 2;
    const nmy = (nb.minY + nb.maxY) / 2;
    const tolX = Math.max(0.01, W * 0.005);
    const tolY = Math.max(0.01, H * 0.005);
    (piece.cutouts || []).forEach((sh) => {
      const sb = rawBox(sh);
      if (!sb || !sh.start) return;
      const cx = (sb.minX + sb.maxX) / 2;
      const cy = (sb.minY + sb.maxY) / 2;
      const tx = Math.abs(cx - mx) < tolX ? nmx - mx : cx > mx ? nb.maxX - b.maxX : nb.minX - b.minX;
      const ty = Math.abs(cy - my) < tolY ? nmy - my : cy > my ? nb.maxY - b.maxY : nb.minY - b.minY;
      sh.start = { x: r4(sh.start.x + tx), y: r4(sh.start.y + ty) };
      if (sh.origin) sh.origin = { x: sh.origin.x + tx, y: sh.origin.y + ty };
    });
  }

  function resizeShape(shape, w, h) {
    const fn = resizeContour(shape, w, h, 'centre');
    if (shape.origin) shape.origin = fn(shape.origin);
  }

  LT.resolve = { resolvePiece, primsToContour, notchSegments, notchPlace, OPS, isCircle, rawBox, resizeContour, resizePiece, resizeShape };
})(typeof window !== 'undefined' ? window : globalThis);
