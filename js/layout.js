// Hole and stitch-line layout for contours and pieces.
//
// Holes sit on a path offset from the leather edge by
// (edge distance + hole radius), toward the material: inward for an
// outline, outward for a cutout. Holes are placed on runs of consecutive
// edges set to 'holes'. Within a run, "anchors" always get a hole:
//   - sharp corners whose corner hole is switched on,
//   - the origin point, when it sits on the run,
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

  function layoutRun(run, contour, spacing, originS) {
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
    if (originS !== null && originS !== undefined) anchors.push(originS);
    anchors.sort((a, b) => a - b);
    const uniq = anchors.filter((a, i) => i === 0 || a - anchors[i - 1] > 1e-6);

    const sections = [];
    let positions = [];
    if (run.closed) {
      if (!uniq.length) uniq.push(0);
      uniq.forEach((a, i) => {
        const b = i + 1 < uniq.length ? uniq[i + 1] : uniq[0] + L;
        const r = distribute(a, b, true, true, spacing);
        sections.push({ ...r, from: a, to: b, path: prims, closed: true });
        positions = positions.concat(r.pos.slice(0, -1)); // end = next anchor
      });
      positions = positions.map((s) => ((s % L) + L) % L);
    } else {
      const inner = uniq.filter((a) => a > 1e-6 && a < L - 1e-6);
      const bps = [0, ...inner, L];
      const flags = [corner(prims[0].vStart), ...inner.map(() => true), corner(prims[prims.length - 1].vEnd)];
      for (let i = 0; i + 1 < bps.length; i++) {
        const r = distribute(bps[i], bps[i + 1], flags[i], flags[i + 1], spacing);
        sections.push({ ...r, from: bps[i], to: bps[i + 1], path: prims, closed: false });
        positions = positions.concat(r.pos);
      }
    }
    positions.sort((a, b) => a - b);
    const dedup = positions.filter((s, i) => i === 0 || s - positions[i - 1] > 1e-6);
    if (run.closed && dedup.length > 1 && L - dedup[dedup.length - 1] + dedup[0] < 1e-6) dedup.pop();
    return { points: dedup.map((s) => G.pathPointAt(prims, s)), sections, path: prims };
  }

  // settings: { holeDiameter, spacing, edgeDistance, stitchOffset }
  // opts: { isOutline, origin: {x, y} | null }
  // The origin snaps to the nearest hole run or stitch line of the contour.
  // On a hole run a hole always lands on it; on a stitch line it is marked
  // with a short tick across the line.
  function layoutContour(contour, settings, opts) {
    const prims = G.buildPrimitives(contour);
    const res = { contour, prims, holes: [], holePaths: [], stitch: [], sections: [], origin: null };
    if (!prims.length) return res;
    const ccw = G.signedArea(prims) > 0;
    const side = opts.isOutline === ccw ? 1 : -1; // +1: material is on the left

    let holeRuns = [];
    if (prims.some((p) => p.mode === 'holes') && settings.spacing > 0) {
      const d = settings.edgeDistance + settings.holeDiameter / 2;
      holeRuns = findRuns(G.offsetPrims(prims, side * d), 'holes');
    }
    if (prims.some((p) => p.mode === 'stitch')) {
      res.stitch = findRuns(G.offsetPrims(prims, side * settings.stitchOffset), 'stitch');
    }

    let best = null;
    if (opts.origin) {
      const consider = (run, kind, i) => {
        const n = G.nearestOnPath(run.prims, opts.origin);
        if (n && (!best || n.d < best.d)) best = { ...n, kind, i };
      };
      holeRuns.forEach((r, i) => consider(r, 'hole', i));
      res.stitch.forEach((r, i) => consider(r, 'stitch', i));
    }

    holeRuns.forEach((run, i) => {
      const s = best && best.kind === 'hole' && best.i === i ? best.s : null;
      const r = layoutRun(run, contour, settings.spacing, s);
      res.holes = res.holes.concat(r.points);
      res.holePaths.push({ prims: r.path, closed: run.closed });
      r.sections.forEach((sec) => res.sections.push({ ...sec, requested: settings.spacing }));
    });

    if (best) {
      const run = best.kind === 'hole' ? holeRuns[best.i] : res.stitch[best.i];
      const ahead = G.pathPointAt(run.prims, Math.min(G.pathLength(run.prims), best.s + 0.01));
      const behind = G.pathPointAt(run.prims, Math.max(0, best.s - 0.01));
      res.origin = { kind: best.kind, pt: G.pathPointAt(run.prims, best.s), tangent: G.norm(G.sub(ahead, behind)) };
    }
    return res;
  }

  function pieceSettings(project) {
    return { ...project.defaults };
  }

  function layoutPiece(project, piece) {
    const settings = pieceSettings(project);
    const resolved = LT.resolve.resolvePiece(piece);
    const empty = { start: null, segments: [], closing: { mode: 'none', fillet: 0, corner: true } };
    const outline = layoutContour(resolved.outline || empty, settings, { isOutline: true, origin: piece.outline.origin || null });
    const cutouts = resolved.cutouts.map((c) => ({
      ...layoutContour(c.contour, settings, { isOutline: false, origin: c.origin }),
      src: c.src,
    }));
    return { settings, outline, cutouts, holeRadius: settings.holeDiameter / 2, resolved };
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

  // A short line across the stitch line marking a stitch-line origin.
  function originTick(origin, half = 3) {
    const n = { x: -origin.tangent.y, y: origin.tangent.x };
    return { type: 'line', a: G.add(origin.pt, G.mul(n, -half)), b: G.add(origin.pt, G.mul(n, half)) };
  }

  LT.layout = { originTick, findRuns, distribute, layoutContour, layoutPiece, pieceSettings, pieceBBox };
})(typeof window !== 'undefined' ? window : globalThis);
