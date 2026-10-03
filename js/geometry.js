// Geometry for leather pattern contours.
//
// All lengths are millimetres, angles in degrees in the data model and
// radians internally. The world coordinate system is y-up (like a CAD
// drawing); screen/SVG output flips y when rendering.
//
// A contour is drawn "turtle style": a start point followed by segments.
//   line: { type: 'line', length, angle }            angle = heading
//   arc:  { type: 'arc',  radius, sweep, angle }     angle = start heading,
//                                                    sweep > 0 turns left (CCW)
// Each segment also carries the properties of the vertex at its START
// (fillet radius, corner hole on/off) and its edge mode ('none' | 'holes' |
// 'stitch'). If the last segment does not end on the start point, an
// implicit closing line is added; its props live in contour.closing.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});

  const TAU = Math.PI * 2;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = (a) => Math.hypot(a.x, a.y);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const norm = (a) => {
    const l = len(a);
    return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
  };
  const perpLeft = (a) => ({ x: -a.y, y: a.x });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const arcPoint = (c, r, ang) => ({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });

  // ---------------------------------------------------------------------
  // Primitive helpers. A primitive is a line {a, b} or an arc
  // {c, r, a0, sweep} (radians, signed sweep).

  function primStart(p) {
    return p.type === 'line' ? p.a : arcPoint(p.c, p.r, p.a0);
  }
  function primEnd(p) {
    return p.type === 'line' ? p.b : arcPoint(p.c, p.r, p.a0 + p.sweep);
  }
  function primLength(p) {
    return p.type === 'line' ? dist(p.a, p.b) : Math.abs(p.sweep) * p.r;
  }
  function primPointAt(p, s) {
    if (p.type === 'line') {
      const L = dist(p.a, p.b);
      const t = L > 0 ? s / L : 0;
      return { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t };
    }
    return arcPoint(p.c, p.r, p.a0 + (Math.sign(p.sweep) * s) / p.r);
  }
  function arcTangent(p, ang) {
    const s = Math.sign(p.sweep);
    return { x: -Math.sin(ang) * s, y: Math.cos(ang) * s };
  }
  function primStartTangent(p) {
    return p.type === 'line' ? norm(sub(p.b, p.a)) : arcTangent(p, p.a0);
  }
  function primEndTangent(p) {
    return p.type === 'line' ? norm(sub(p.b, p.a)) : arcTangent(p, p.a0 + p.sweep);
  }

  // Distance along p of the point on p nearest to pt.
  function projectOnPrim(p, pt) {
    if (p.type === 'line') {
      const L = dist(p.a, p.b);
      if (L === 0) return 0;
      const t = dot(sub(pt, p.a), sub(p.b, p.a)) / L;
      return Math.max(0, Math.min(L, t));
    }
    const ang = Math.atan2(pt.y - p.c.y, pt.x - p.c.x);
    let d = (ang - p.a0) * Math.sign(p.sweep);
    d = ((d % TAU) + TAU) % TAU;
    const sw = Math.abs(p.sweep);
    if (d > sw) d = d - sw < TAU - d ? sw : 0;
    return d * p.r;
  }

  // Pick the representation of an angle difference closest to `target`.
  function closestAngle(delta, target) {
    return delta + TAU * Math.round((target - delta) / TAU);
  }
  function setPrimStart(p, X) {
    if (p.type === 'line') {
      p.a = X;
      return;
    }
    const endAng = p.a0 + p.sweep;
    const a0 = Math.atan2(X.y - p.c.y, X.x - p.c.x);
    p.sweep = closestAngle(endAng - a0, p.sweep);
    p.a0 = a0;
  }
  function setPrimEnd(p, X) {
    if (p.type === 'line') {
      p.b = X;
      return;
    }
    const a1 = Math.atan2(X.y - p.c.y, X.x - p.c.x);
    p.sweep = closestAngle(a1 - p.a0, p.sweep);
  }

  // ---------------------------------------------------------------------
  // Contour model helpers

  function vertexProps(contour, src) {
    const n = contour.segments.length;
    const p = src < n ? contour.segments[src] : contour.closing || {};
    return {
      fillet: Number(p.fillet) || 0,
      corner: p.corner !== false,
      mode: p.mode || 'none',
    };
  }

  // Raw edges (no fillets). Each edge carries `src` = segment index, or
  // segments.length for the implicit closing line.
  function buildEdges(contour) {
    const edges = [];
    if (!contour || !contour.start || !contour.segments.length) return edges;
    let p = { x: contour.start.x, y: contour.start.y };
    contour.segments.forEach((seg, i) => {
      const h = rad(Number(seg.angle) || 0);
      if (seg.type === 'arc') {
        const r = Number(seg.radius);
        const sw = rad(Number(seg.sweep));
        if (!(r > 0) || !sw) return;
        const s = Math.sign(sw);
        const c = add(p, mul({ x: -Math.sin(h), y: Math.cos(h) }, r * s));
        const a0 = Math.atan2(p.y - c.y, p.x - c.x);
        const e = { type: 'arc', c, r, a0, sweep: sw, edge: i };
        edges.push(e);
        p = primEnd(e);
      } else {
        const L = Number(seg.length);
        if (!(L > 0)) return;
        const q = { x: p.x + L * Math.cos(h), y: p.y + L * Math.sin(h) };
        edges.push({ type: 'line', a: p, b: q, edge: i });
        p = q;
      }
    });
    if (edges.length && dist(p, contour.start) > 1e-6) {
      edges.push({
        type: 'line',
        a: p,
        b: { x: contour.start.x, y: contour.start.y },
        edge: contour.segments.length,
        closing: true,
      });
    }
    return edges;
  }

  // Information about the implicit closing edge (for the UI).
  function closingEdge(contour) {
    const edges = buildEdges(contour);
    const last = edges[edges.length - 1];
    if (!last || !last.closing) return null;
    const d = sub(last.b, last.a);
    return { length: len(d), angle: deg(Math.atan2(d.y, d.x)) };
  }

  // Heading (degrees) at the end of the drawn segments.
  function endHeading(contour) {
    const segs = contour.segments;
    if (!segs.length) return 0;
    const s = segs[segs.length - 1];
    return (Number(s.angle) || 0) + (s.type === 'arc' ? Number(s.sweep) || 0 : 0);
  }

  function endPoint(contour) {
    const edges = buildEdges(contour).filter((e) => !e.closing);
    if (!edges.length) return contour.start;
    return primEnd(edges[edges.length - 1]);
  }

  // Edges with fillets applied: returns primitives tagged with
  //   edge   (source edge index) or fillet (vertex index),
  //   vStart / vEnd (vertex index at each end),
  //   mode   ('none' | 'holes' | 'stitch').
  function buildPrimitives(contour) {
    const edges = buildEdges(contour);
    const n = edges.length;
    if (!n) return [];
    const out = edges.map((e) => ({ ...e, a: e.a && { ...e.a }, b: e.b && { ...e.b } }));
    const fillets = new Array(n).fill(null);
    for (let i = 0; i < n && n > 1; i++) {
      const prevIdx = (i - 1 + n) % n;
      const prev = edges[prevIdx];
      const cur = edges[i];
      let r = vertexProps(contour, cur.edge).fillet;
      if (!(r > 0) || prev.type !== 'line' || cur.type !== 'line') continue;
      const u1 = norm(sub(prev.b, prev.a));
      const u2 = norm(sub(cur.b, cur.a));
      const cr = cross(u1, u2);
      if (Math.abs(cr) < 1e-9) continue;
      const phi = Math.acos(Math.max(-1, Math.min(1, dot(mul(u1, -1), u2))));
      let t = r / Math.tan(phi / 2);
      const maxT = Math.min(dist(prev.a, prev.b), dist(cur.a, cur.b)) / 2;
      if (t > maxT) {
        t = maxT;
        r = t * Math.tan(phi / 2);
      }
      const P = cur.a;
      const T1 = sub(P, mul(u1, t));
      const T2 = add(P, mul(u2, t));
      const C = add(P, mul(norm(sub(u2, u1)), r / Math.sin(phi / 2)));
      fillets[i] = {
        type: 'arc',
        c: C,
        r,
        a0: Math.atan2(T1.y - C.y, T1.x - C.x),
        sweep: Math.sign(cr) * (Math.PI - phi),
        fillet: cur.edge,
      };
      out[prevIdx].b = T1;
      out[i].a = T2;
    }
    const prims = [];
    for (let i = 0; i < n; i++) {
      const v = edges[i].edge;
      if (fillets[i]) prims.push({ ...fillets[i], vStart: v, vEnd: v });
      prims.push({ ...out[i], vStart: v, vEnd: edges[(i + 1) % n].edge });
    }
    const m = prims.length;
    prims.forEach((p) => {
      if (p.fillet === undefined) p.mode = vertexProps(contour, p.edge).mode;
    });
    prims.forEach((p, i) => {
      if (p.fillet === undefined) return;
      const a = prims[(i - 1 + m) % m].mode;
      const b = prims[(i + 1) % m].mode;
      p.mode = a === b ? a : 'none';
    });
    return prims;
  }

  function samplePoints(prims, perArc = 24) {
    const pts = [];
    prims.forEach((p) => {
      if (p.type === 'line') {
        pts.push(p.a);
      } else {
        const k = Math.max(2, Math.ceil((Math.abs(p.sweep) / TAU) * perArc * 4));
        for (let i = 0; i < k; i++) pts.push(arcPoint(p.c, p.r, p.a0 + (p.sweep * i) / k));
      }
    });
    return pts;
  }

  function signedArea(prims) {
    const pts = samplePoints(prims);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  function bbox(prims, pad = 0) {
    const pts = samplePoints(prims, 64);
    prims.forEach((p) => pts.push(primEnd(p)));
    if (!pts.length) return null;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    pts.forEach((p) => {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    });
    b.minX -= pad;
    b.minY -= pad;
    b.maxX += pad;
    b.maxY += pad;
    return b;
  }

  // ---------------------------------------------------------------------
  // Intersections of the infinite extensions of two primitives.

  function intersections(A, B) {
    if (A.type === 'line' && B.type === 'line') {
      const d1 = sub(A.b, A.a);
      const d2 = sub(B.b, B.a);
      const den = cross(d1, d2);
      if (Math.abs(den) < 1e-12) return [];
      const t = cross(sub(B.a, A.a), d2) / den;
      return [add(A.a, mul(d1, t))];
    }
    if (A.type === 'arc' && B.type === 'arc') {
      const d = dist(A.c, B.c);
      if (d < 1e-12 || d > A.r + B.r + 1e-9 || d < Math.abs(A.r - B.r) - 1e-9) return [];
      const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
      const u = norm(sub(B.c, A.c));
      const pm = add(A.c, mul(u, a));
      const pp = perpLeft(u);
      return [add(pm, mul(pp, h)), sub(pm, mul(pp, h))];
    }
    const L = A.type === 'line' ? A : B;
    const C = A.type === 'line' ? B : A;
    const d = norm(sub(L.b, L.a));
    const f = sub(L.a, C.c);
    const b = dot(f, d);
    const disc = b * b - (dot(f, f) - C.r * C.r);
    if (disc < -1e-9) return [];
    const sq = Math.sqrt(Math.max(0, disc));
    return [add(L.a, mul(d, -b - sq)), add(L.a, mul(d, -b + sq))];
  }

  // Offset a closed loop of primitives sideways by dLeft (positive = to the
  // left of the direction of travel). Sharp corners are joined by extending
  // or trimming neighbours to their intersection; arcs that shrink to
  // nothing are dropped.
  function offsetPrims(prims, dLeft) {
    const out = [];
    prims.forEach((p) => {
      if (p.type === 'line') {
        if (dist(p.a, p.b) < 1e-9) return;
        const n = mul(perpLeft(norm(sub(p.b, p.a))), dLeft);
        out.push({ ...p, a: add(p.a, n), b: add(p.b, n) });
      } else {
        const r = p.r - Math.sign(p.sweep) * dLeft;
        if (r > 1e-6) out.push({ ...p, r });
      }
    });
    const m = out.length;
    if (m < 2) return out;
    const bridges = [];
    for (let j = 0; j < m; j++) {
      const A = out[j];
      const B = out[(j + 1) % m];
      const eA = primEnd(A);
      const sB = primStart(B);
      if (dist(eA, sB) < 1e-6) continue;
      const ref = mid(eA, sB);
      const cands = intersections(A, B);
      if (!cands.length) {
        bridges.push({ after: j, prim: { ...A, type: 'line', a: eA, b: sB } });
        continue;
      }
      let X = cands[0];
      cands.forEach((c) => {
        if (dist(c, ref) < dist(X, ref)) X = c;
      });
      setPrimEnd(A, X);
      setPrimStart(B, X);
    }
    if (!bridges.length) return out;
    const res = [];
    out.forEach((p, j) => {
      res.push(p);
      bridges.filter((b) => b.after === j).forEach((b) => res.push(b.prim));
    });
    return res;
  }

  function pathLength(prims) {
    return prims.reduce((s, p) => s + primLength(p), 0);
  }

  function pathPointAt(prims, s) {
    let acc = 0;
    for (const p of prims) {
      const L = primLength(p);
      if (s <= acc + L + 1e-9) return primPointAt(p, Math.max(0, s - acc));
      acc += L;
    }
    return primEnd(prims[prims.length - 1]);
  }

  // Point on an edge of the raw (unfilleted) contour, `offset` mm from the
  // edge's start.
  function pointOnEdge(contour, edgeIdx, offset) {
    const e = buildEdges(contour).find((x) => x.edge === edgeIdx);
    if (!e) return null;
    const s = Math.max(0, Math.min(primLength(e), Number(offset) || 0));
    return primPointAt(e, s);
  }

  LT.geom = {
    TAU,
    rad,
    deg,
    add,
    sub,
    mul,
    dot,
    cross,
    len,
    dist,
    norm,
    arcPoint,
    primStart,
    primEnd,
    primLength,
    primPointAt,
    primStartTangent,
    primEndTangent,
    projectOnPrim,
    vertexProps,
    buildEdges,
    buildPrimitives,
    closingEdge,
    endHeading,
    endPoint,
    samplePoints,
    signedArea,
    bbox,
    intersections,
    offsetPrims,
    pathLength,
    pathPointAt,
    pointOnEdge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
