// Assembly preview: pieces stacked flat on top of each other, lined up by
// their origin points, so you can see how they fit and whether the holes
// that should share a stitch actually line up.
//
// project.assembly.pieces[pieceId] = { on, dx, dy, rot, flip }
//   on    shown in the stack
//   dx,dy extra offset (mm) after lining up by origin
//   rot   rotation in degrees (multiples of 90 from the buttons)
//   flip  turned over (mirrored left to right)
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  const COLORS = ['#2563eb', '#d9480f', '#2f9e44', '#ae3ec9', '#0c8599', '#c2255c', '#e8590c', '#5c940d'];

  function entryFor(project, pc) {
    const a = (project.assembly && project.assembly.pieces) || {};
    return { on: true, dx: 0, dy: 0, rot: 0, flip: false, ...(a[pc.id] || {}) };
  }

  // The point of a laid-out piece that sits at the assembly's origin: its
  // origin point if it has one, otherwise the middle of the piece.
  function anchorOf(lay) {
    if (lay.outline.origin) return { pt: lay.outline.origin.pt, hasOrigin: true };
    const b = LT.layout.pieceBBox(lay);
    if (!b) return { pt: { x: 0, y: 0 }, hasOrigin: false };
    return { pt: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, hasOrigin: false };
  }

  // Map from piece coordinates to assembly coordinates.
  function transform(anchor, e) {
    const th = G.rad(Number(e.rot) || 0);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const fx = e.flip ? -1 : 1;
    const point = (p) => {
      const x = (p.x - anchor.x) * fx;
      const y = p.y - anchor.y;
      return { x: x * c - y * s + (Number(e.dx) || 0), y: x * s + y * c + (Number(e.dy) || 0) };
    };
    const prim = (p) => {
      if (p.type === 'line') return { ...p, a: point(p.a), b: point(p.b) };
      const a0 = (e.flip ? Math.PI - p.a0 : p.a0) + th;
      return { ...p, c: point(p.c), a0, sweep: e.flip ? -p.sweep : p.sweep };
    };
    return { point, prim };
  }

  function pointInPoly(poly, pt) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function distToPath(prims, pt) {
    const n = prims.length ? G.nearestOnPath(prims, pt) : null;
    return n ? n.d : Infinity;
  }

  // Lay out every piece that is switched on, in assembly coordinates.
  function buildAssembly(project) {
    const items = [];
    project.pieces.forEach((pc, i) => {
      const e = entryFor(project, pc);
      if (!pc.outline.segments.length) return;
      const lay = LT.layout.layoutPiece(project, pc);
      const anchor = anchorOf(lay);
      const tf = transform(anchor.pt, e);
      const all = [lay.outline, ...lay.cutouts];
      items.push({
        piece: pc,
        index: i,
        on: e.on !== false,
        entry: e,
        color: COLORS[i % COLORS.length],
        hasOrigin: anchor.hasOrigin,
        origin: tf.point(anchor.pt),
        outline: lay.outline.prims.map(tf.prim),
        cutouts: lay.cutouts.map((c) => c.prims.map(tf.prim)),
        stitch: all.flatMap((c) => c.stitch.map((st) => ({ prims: st.prims.map(tf.prim), closed: st.closed }))),
        holes: all.flatMap((c) => c.holes.map(tf.point)),
        holeRadius: lay.holeRadius,
      });
    });
    const shown = items.filter((it) => it.on);
    return { items, shown, check: checkHoles(shown) };
  }

  // Wherever a hole of one piece lands on another piece's leather, the
  // stitch goes through both, so the other piece needs a hole there too.
  // Returns { pairs: [{ a, b, matched, missed }], bad: [{ item, pt, other }] }.
  function checkHoles(shown) {
    const pairs = [];
    const bad = [];
    shown.forEach((A) => {
      shown.forEach((B) => {
        if (A === B) return;
        const poly = G.samplePoints(B.outline, 48);
        const holesPolys = B.cutouts.map((c) => G.samplePoints(c, 48));
        const reach = Math.max(A.holeRadius, B.holeRadius);
        const tol = Math.max(0.3, Math.min(A.holeRadius, B.holeRadius) * 0.5);
        let matched = 0;
        let missed = 0;
        A.holes.forEach((h) => {
          const onLeather =
            (pointInPoly(poly, h) || distToPath(B.outline, h) <= reach) &&
            !holesPolys.some((hp, k) => pointInPoly(hp, h) && distToPath(B.cutouts[k], h) > reach);
          if (!onLeather) return;
          if (B.holes.some((q) => G.dist(q, h) <= tol)) matched++;
          else {
            missed++;
            bad.push({ item: A, pt: h, other: B });
          }
        });
        if (matched || missed) pairs.push({ a: A, b: B, matched, missed });
      });
    });
    return { pairs, bad };
  }

  LT.assembly = { COLORS, entryFor, anchorOf, transform, buildAssembly, checkHoles };
})(typeof window !== 'undefined' ? window : globalThis);
