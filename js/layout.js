// Hole and stitch-line layout for contours and pieces.
//
// Holes sit on a path offset from the leather edge by
// (edge distance + hole radius), toward the material: inward for an
// outline, outward for a cutout. Holes are placed on runs of consecutive
// edges set to 'holes'. Within a run, "anchors" always get a hole:
//   - sharp corners whose corner hole is switched on,
//   - the piece's zero point, when it falls on the run,
//   - run ends, when the corner hole at that end is switched on.
// Between anchors the spacing is stretched or shrunk slightly so the holes
// divide the distance evenly. An end without an anchor is inset by half a
// spacing.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  const SHARP = (2 * Math.PI) / 180; // a turn sharper than 2 degrees is a corner

  function findRuns(prims, mode) {
    const m = prims.length;
    const on = prims.map((p) => p.mode === mode);
    if (!on.some(Boolean)) return [];
    if (on.every(Boolean)) return [{ prims: prims.slice(), closed: true }];
    const runs = [];
    const k = on.indexOf(false);
    let cur = null;
    for (let i = 1; i <= m; i++) {
      const j = (k + i) % m;
      if (on[j]) {
        if (!cur) cur = { prims: [], closed: false };
        cur.prims.push(prims[j]);
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
    return runs;
  }

  function isSharp(A, B) {
    const a = G.primEndTangent(A);
    const b = G.primStartTangent(B);
    return Math.acos(Math.max(-1, Math.min(1, G.dot(a, b)))) > SHARP;
  }

  // Positions along one section [s0, s1].
  function distribute(s0, s1, anchored0, anchored1, spacing) {
    const length = s1 - s0;
    const in0 = anchored0 ? 0 : spacing / 2;
    const in1 = anchored1 ? 0 : spacing / 2;
    const eff = length - in0 - in1;
    if (eff < 1e-9) {
      if (anchored0 && anchored1) return { pos: [s0, s1], actual: length, length };
      if (anchored0) return { pos: [s0], actual: null, length };
      if (anchored1) return { pos: [s1], actual: null, length };
      return { pos: length > 0 ? [s0 + length / 2] : [], actual: null, length };
    }
    const n = Math.max(1, Math.round(eff / spacing));
    const actual = eff / n;
    const pos = [];
    for (let k = 0; k <= n; k++) pos.push(s0 + in0 + k * actual);
    return { pos, actual, length };
  }

  function layoutRun(run, contour, spacing, zeroPt) {
    const prims = run.prims;
    const cum = [0];
    prims.forEach((p) => cum.push(cum[cum.length - 1] + G.primLength(p)));
    const L = cum[cum.length - 1];
    const corner = (v) => G.vertexProps(contour, v).corner;

    const anchors = [];
    for (let j = 1; j < prims.length; j++) {
      if (isSharp(prims[j - 1], prims[j]) && corner(prims[j].vStart)) anchors.push(cum[j]);
    }
    if (run.closed && isSharp(prims[prims.length - 1], prims[0]) && corner(prims[0].vStart)) {
      anchors.push(0);
    }
    if (zeroPt) {
      let best = null;
      prims.forEach((p, j) => {
        if (p.edge !== zeroPt.edge || p.fillet !== undefined) return;
        const s = G.projectOnPrim(p, zeroPt.pt);
        const d = G.dist(G.primPointAt(p, s), zeroPt.pt);
        if (!best || d < best.d) best = { d, s: cum[j] + s };
      });
      if (best) anchors.push(best.s);
    }
    anchors.sort((a, b) => a - b);
    const uniq = anchors.filter((a, i) => i === 0 || a - anchors[i - 1] > 1e-6);

    const sections = [];
    let positions = [];
    if (run.closed) {
      if (!uniq.length) uniq.push(0);
      uniq.forEach((a, i) => {
        const b = i + 1 < uniq.length ? uniq[i + 1] : uniq[0] + L;
        const r = distribute(a, b, true, true, spacing);
        sections.push(r);
        positions = positions.concat(r.pos.slice(0, -1)); // end = next anchor
      });
      positions = positions.map((s) => ((s % L) + L) % L);
    } else {
      const inner = uniq.filter((a) => a > 1e-6 && a < L - 1e-6);
      const bps = [0, ...inner, L];
      const flags = [corner(prims[0].vStart), ...inner.map(() => true), corner(prims[prims.length - 1].vEnd)];
      for (let i = 0; i + 1 < bps.length; i++) {
        const r = distribute(bps[i], bps[i + 1], flags[i], flags[i + 1], spacing);
        sections.push(r);
        positions = positions.concat(r.pos);
      }
    }
    positions.sort((a, b) => a - b);
    const dedup = positions.filter((s, i) => i === 0 || s - positions[i - 1] > 1e-6);
    if (run.closed && dedup.length > 1 && L - dedup[dedup.length - 1] + dedup[0] < 1e-6) dedup.pop();
    return { points: dedup.map((s) => G.pathPointAt(prims, s)), sections, path: prims };
  }

  // settings: { holeDiameter, spacing, edgeDistance, stitchOffset }
  // opts: { isOutline, zero: { edge, offset } | null }
  function layoutContour(contour, settings, opts) {
    const prims = G.buildPrimitives(contour);
    const res = { prims, holes: [], holePaths: [], stitch: [], sections: [] };
    if (!prims.length) return res;
    const ccw = G.signedArea(prims) > 0;
    const side = opts.isOutline === ccw ? 1 : -1; // +1: material is on the left

    if (prims.some((p) => p.mode === 'holes') && settings.spacing > 0) {
      const d = settings.edgeDistance + settings.holeDiameter / 2;
      const off = G.offsetPrims(prims, side * d);
      let zeroPt = null;
      if (opts.zero) {
        const pt = G.pointOnEdge(contour, opts.zero.edge, opts.zero.offset);
        if (pt) zeroPt = { edge: opts.zero.edge, pt };
      }
      findRuns(off, 'holes').forEach((run) => {
        const r = layoutRun(run, contour, settings.spacing, zeroPt);
        res.holes = res.holes.concat(r.points);
        res.holePaths.push({ prims: r.path, closed: run.closed });
        r.sections.forEach((s) => res.sections.push({ ...s, requested: settings.spacing }));
      });
    }
    if (prims.some((p) => p.mode === 'stitch')) {
      const off = G.offsetPrims(prims, side * settings.stitchOffset);
      res.stitch = findRuns(off, 'stitch');
    }
    return res;
  }

  function pieceSettings(project, piece) {
    const s = { ...project.defaults };
    if (piece.customSettings && piece.settings) {
      Object.keys(s).forEach((k) => {
        const v = Number(piece.settings[k]);
        if (Number.isFinite(v) && v >= 0) s[k] = v;
      });
    }
    return s;
  }

  function layoutPiece(project, piece) {
    const settings = pieceSettings(project, piece);
    const zero = piece.zero && piece.zero.enabled ? piece.zero : null;
    const outline = layoutContour(piece.outline, settings, { isOutline: true, zero });
    const cutouts = (piece.cutouts || []).map((c) => layoutContour(c, settings, { isOutline: false, zero: null }));
    return { settings, outline, cutouts, holeRadius: settings.holeDiameter / 2 };
  }

  // Bounding box of everything that gets drawn for a laid-out piece.
  function pieceBBox(lay) {
    const all = [lay.outline, ...lay.cutouts];
    const prims = [];
    all.forEach((c) => prims.push(...c.prims));
    const b = G.bbox(prims);
    if (!b) return null;
    all.forEach((c) =>
      c.holes.forEach((h) => {
        b.minX = Math.min(b.minX, h.x - lay.holeRadius);
        b.minY = Math.min(b.minY, h.y - lay.holeRadius);
        b.maxX = Math.max(b.maxX, h.x + lay.holeRadius);
        b.maxY = Math.max(b.maxY, h.y + lay.holeRadius);
      })
    );
    return b;
  }

  LT.layout = { findRuns, distribute, layoutContour, layoutPiece, pieceSettings, pieceBBox };
})(typeof window !== 'undefined' ? window : globalThis);
