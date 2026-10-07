// Combining shapes: split two closed loops where they cross, keep the
// pieces you want, and trace the kept pieces back into closed loops.
//
//   merge    (union):        everything inside either shape
//   cut      (A minus B):    shape A with shape B's area removed
//   overlap  (intersection): only the area inside both shapes
//
// Pieces can also be picked by hand ("choose lines"); tracing then follows
// whichever kept pieces join end to end.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  const TOL = 1e-5; // mm: points closer than this are the same point
  const ON = 1e-4; // mm: a piece this close to the other shape lies on it

  function reversePrim(p) {
    if (p.type === 'line') return { ...p, a: p.b, b: p.a };
    return { ...p, a0: p.a0 + p.sweep, sweep: -p.sweep };
  }

  function reverseLoop(prims) {
    return prims.slice().reverse().map(reversePrim);
  }

  function ccw(prims) {
    return G.signedArea(prims) > 0 ? prims : reverseLoop(prims);
  }

  // Distance along p of pt, or null when pt is not on p.
  function paramOn(p, pt) {
    const s = G.projectOnPrim(p, pt);
    return G.dist(G.primPointAt(p, s), pt) < TOL * 10 ? s : null;
  }

  function subPrim(p, s0, s1) {
    if (p.type === 'line') {
      return { ...p, a: G.primPointAt(p, s0), b: G.primPointAt(p, s1) };
    }
    const sg = Math.sign(p.sweep);
    return { ...p, a0: p.a0 + (sg * s0) / p.r, sweep: (sg * (s1 - s0)) / p.r };
  }

  // Split every primitive of `loop` wherever it meets `other`.
  function splitLoop(loop, other) {
    const out = [];
    loop.forEach((p) => {
      const L = G.primLength(p);
      const cuts = [];
      other.forEach((q) => {
        G.intersections(p, q).forEach((pt) => {
          const s = paramOn(p, pt);
          if (s !== null && paramOn(q, pt) !== null) cuts.push(s);
        });
        // Endpoints of the other shape that touch this primitive
        // (handles shared edges and T-junctions).
        [G.primStart(q), G.primEnd(q)].forEach((pt) => {
          const s = paramOn(p, pt);
          if (s !== null) cuts.push(s);
        });
      });
      cuts.sort((a, b) => a - b);
      let prev = 0;
      cuts.forEach((s) => {
        if (s - prev > TOL && L - s > TOL) {
          out.push(subPrim(p, prev, s));
          prev = s;
        }
      });
      out.push(subPrim(p, prev, L));
    });
    return out.filter((p) => G.primLength(p) > TOL);
  }

  function tangentAt(p, s) {
    if (p.type === 'line') return G.primStartTangent(p);
    const ang = p.a0 + (Math.sign(p.sweep) * s) / p.r;
    const sg = Math.sign(p.sweep);
    return { x: -Math.sin(ang) * sg, y: Math.cos(ang) * sg };
  }

  function polygon(prims) {
    return G.samplePoints(prims, 64);
  }

  function inside(poly, pt) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  // 'in' | 'out' | 'same' (on the other boundary, same direction) | 'opposite'
  function classify(piece, other, otherPoly) {
    const m = G.primPointAt(piece, G.primLength(piece) / 2);
    let best = null;
    other.forEach((q) => {
      const s = G.projectOnPrim(q, m);
      const d = G.dist(G.primPointAt(q, s), m);
      if (!best || d < best.d) best = { d, q, s };
    });
    if (best && best.d < ON) {
      const tq = tangentAt(best.q, best.s);
      const tp = tangentAt(piece, G.primLength(piece) / 2);
      return G.dot(tq, tp) > 0 ? 'same' : 'opposite';
    }
    return inside(otherPoly, m) ? 'in' : 'out';
  }

  const RULES = {
    merge: { A: ['out', 'same'], B: ['out'] },
    cut: { A: ['out', 'opposite'], B: ['in'] },
    overlap: { A: ['in', 'same'], B: ['in'] },
  };

  // Split both shapes and label every piece. A and B are primitive loops.
  function splitShapes(A, B) {
    const a = ccw(A);
    const b = ccw(B);
    const pa = polygon(a);
    const pb = polygon(b);
    const pieces = [];
    splitLoop(a, b).forEach((p) => pieces.push({ prim: p, from: 'A', where: classify(p, b, pb) }));
    splitLoop(b, a).forEach((p) => pieces.push({ prim: p, from: 'B', where: classify(p, a, pa) }));
    return pieces;
  }

  function preset(pieces, op) {
    const r = RULES[op];
    pieces.forEach((pc) => {
      pc.keep = r[pc.from].includes(pc.where);
    });
    return pieces;
  }

  // Join kept pieces into closed loops. For 'cut', B pieces run backwards.
  function trace(pieces, op) {
    const items = pieces
      .filter((pc) => pc.keep)
      .map((pc) => ({ prim: op === 'cut' && pc.from === 'B' ? reversePrim(pc.prim) : pc.prim, used: false }));
    const loops = [];
    let open = 0;
    for (const first of items) {
      if (first.used) continue;
      first.used = true;
      const loop = [first.prim];
      const start = G.primStart(first.prim);
      let cur = G.primEnd(first.prim);
      let closed = G.dist(cur, start) < TOL * 10;
      while (!closed) {
        let next = items.find((it) => !it.used && G.dist(G.primStart(it.prim), cur) < TOL * 10);
        let prim = next && next.prim;
        if (!next) {
          next = items.find((it) => !it.used && G.dist(G.primEnd(it.prim), cur) < TOL * 10);
          prim = next && reversePrim(next.prim);
        }
        if (!next) break;
        next.used = true;
        loop.push(prim);
        cur = G.primEnd(prim);
        closed = G.dist(cur, start) < TOL * 10;
      }
      if (closed) loops.push(simplify(loop));
      else open++;
    }
    return { loops, open };
  }

  // Merge neighbouring collinear lines and arcs on the same circle.
  function simplify(loop) {
    const out = [];
    loop.forEach((p) => {
      const q = out[out.length - 1];
      if (q && q.type === 'line' && p.type === 'line' && q.mode === p.mode) {
        const t1 = G.primStartTangent(q);
        const t2 = G.primStartTangent(p);
        if (Math.abs(G.cross(t1, t2)) < 1e-9 && G.dot(t1, t2) > 0) {
          out[out.length - 1] = { ...q, b: p.b };
          return;
        }
      }
      if (q && q.type === 'arc' && p.type === 'arc' && q.mode === p.mode &&
          G.dist(q.c, p.c) < TOL && Math.abs(q.r - p.r) < TOL && Math.sign(q.sweep) === Math.sign(p.sweep) &&
          Math.abs(q.sweep + p.sweep) <= G.TAU + 1e-9) {
        out[out.length - 1] = { ...q, sweep: q.sweep + p.sweep };
        return;
      }
      out.push(p);
    });
    // The first and last pieces may also join.
    if (out.length > 2) {
      const first = out[0];
      const last = out[out.length - 1];
      if (first.type === 'line' && last.type === 'line' && first.mode === last.mode) {
        const t1 = G.primStartTangent(last);
        const t2 = G.primStartTangent(first);
        if (Math.abs(G.cross(t1, t2)) < 1e-9 && G.dot(t1, t2) > 0) {
          out.pop();
          out[0] = { ...first, a: last.a };
        }
      }
    }
    return out;
  }

  const norm360 = (d) => ((d % 360) + 360) % 360;

  // Turn a loop of primitives back into an editable contour.
  function loopToContour(loop) {
    const M = LT.model;
    const c = M.newContour();
    const s = G.primStart(loop[0]);
    c.start = { x: s.x, y: s.y };
    c.segments = loop.map((p) => {
      const t = G.primStartTangent(p);
      const angle = norm360(G.deg(Math.atan2(t.y, t.x)));
      const mode = p.mode || 'none';
      if (p.type === 'line') return M.seg('line', { length: G.dist(p.a, p.b), angle, mode });
      return M.seg('arc', { radius: p.r, sweep: G.deg(p.sweep), angle, mode });
    });
    return c;
  }

  // Combine contour B into contour A. Returns { outline, holes, extra, open }
  // with contours; `extra` counts separate parts that were dropped.
  function combine(contourA, contourB, op, pieces) {
    const A = G.buildPrimitives(contourA);
    const B = G.buildPrimitives(contourB);
    const list = pieces || preset(splitShapes(A, B), op);
    const { loops, open } = trace(list, op);
    if (!loops.length) return { outline: null, holes: [], extra: 0, open };
    // Largest loop becomes the outline; loops inside it become cutouts.
    const all = loops.map((l) => ccw(l)).sort((x, y) => G.signedArea(y) - G.signedArea(x));
    const outer = all[0];
    const poly = polygon(outer);
    const holes = [];
    let extra = 0;
    all.slice(1).forEach((l) => {
      const m = G.primPointAt(l[0], G.primLength(l[0]) / 2);
      if (inside(poly, m)) holes.push(loopToContour(l));
      else extra++;
    });
    return { outline: loopToContour(outer), holes, extra, open };
  }

  LT.boolean = { splitShapes, splitLoop, subPrim, paramOn, preset, trace, simplify, combine, loopToContour, reversePrim, RULES };
})(typeof window !== 'undefined' ? window : globalThis);
