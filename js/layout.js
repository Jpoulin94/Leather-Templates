// Hole and stitch-line layout for contours and pieces.
//
// Holes sit on a path offset from the leather edge by
// (edge distance + hole radius), toward the material: inward for an
// outline, outward for a cutout. Holes are placed on runs of consecutive
// edges set to 'holes'. Within a run, "anchors" always get a hole:
//   - sharp corners whose corner hole is switched on,
//   - the origin point, when it sits on the run.
// Between anchors the spacing is stretched or shrunk slightly so the holes
// divide the distance evenly. Where a run ends at an edge without holes
// (an open end) that edge is ignored: holes carry on at exactly the set
// spacing from the nearest anchor, right up to that edge, as long as each
// leaves at least MARGIN of leather before it. A run with no anchors
// starts with a hole at its start.
//
// If the next hole of the pattern would touch or cross that edge, the
// edge would cut through it on a piece stacked with this one, so the end
// is flagged with the nearest edge positions that clear it (`openEnds`).
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

  // reach: how far holes may run on past each open end ({ start, end }, mm).
  function layoutRun(run, contour, spacing, originS, reach) {
    reach = reach || { start: 0, end: 0 };
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
    const fixed = { start: true, end: true };
    const pinned = { start: 0, end: L }; // pattern anchor nearest each end
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
      // Open ends: exact spacing outward from the nearest anchor.
      const inner = uniq.filter((a) => a > -1e-6 && a < L + 1e-6);
      // No anchors: the pattern starts at the run's start (inset by half a
      // spacing when that corner's hole is switched off).
      if (!inner.length) inner.push(Math.min(L, corner(prims[0].vStart) ? 0 : spacing / 2));
      // An end where the pattern is pinned is never checked for clearance.
      fixed.start = !uniq.length || inner[0] < 1e-6;
      fixed.end = inner[inner.length - 1] > L - 1e-6;
      pinned.start = inner[0];
      pinned.end = inner[inner.length - 1];
      const first = inner[0];
      const last = inner[inner.length - 1];
      const exact = (from, to, dir) => {
        const pos = [];
        for (let s = from; dir > 0 ? s <= to + 1e-6 : s >= to - 1e-6; s += dir * spacing) pos.push(s);
        return pos;
      };
      if (!fixed.start) {
        positions = positions.concat(exact(first, -reach.start, -1));
        if (first > 1e-6) sections.push({ pos: [], actual: spacing, length: first, from: 0, to: first, path: prims, closed: false });
      }
      for (let i = 0; i + 1 < inner.length; i++) {
        const r = distribute(inner[i], inner[i + 1], true, true, spacing);
        sections.push({ ...r, from: inner[i], to: inner[i + 1], path: prims, closed: false });
        positions = positions.concat(r.pos);
      }
      positions = positions.concat(exact(last, fixed.end ? L : L + reach.end, 1));
      if (L - last > 1e-6) sections.push({ pos: [], actual: spacing, length: L - last, from: last, to: L, path: prims, closed: false });
    }
    positions.sort((a, b) => a - b);
    const dedup = positions.filter((s, i) => i === 0 || s - positions[i - 1] > 1e-6);
    if (run.closed && dedup.length > 1 && L - dedup[dedup.length - 1] + dedup[0] < 1e-6) dedup.pop();
    return { points: dedup.map((s) => pointAt(prims, L, s)), positions: dedup, sections, path: prims, length: L, fixed, pinned };
  }

  // A point along a run, carrying straight on past either end.
  function pointAt(prims, L, s) {
    if (s < 0) return G.add(G.primStart(prims[0]), G.mul(G.primStartTangent(prims[0]), s));
    if (s > L) return G.add(G.primEnd(prims[prims.length - 1]), G.mul(G.primEndTangent(prims[prims.length - 1]), s - L));
    return G.pathPointAt(prims, s);
  }

  const segOf = (contour, idx) => (idx < contour.segments.length ? contour.segments[idx] : contour.closing) || {};

  const MARGIN = 0.5; // least leather between a hole and an edge without holes

  // Where the line of holes, carried on past each end of an open run, meets
  // the edge without holes on the other side of the corner.
  //   t     distance from the run's end to that edge
  //   g     how far a hole's centre must stay from the crossing to clear it
  function endInfo(run, rawPrims, holeRadius) {
    const out = { start: null, end: null };
    if (run.closed) return out;
    const P = run.prims;
    ['end', 'start'].forEach((which) => {
      const atEnd = which === 'end';
      const edgePrim = atEnd ? [...P].reverse().find((p) => p.fillet === undefined) : P.find((p) => p.fillet === undefined);
      if (!edgePrim) return;
      const E = atEnd ? G.primEnd(P[P.length - 1]) : G.primStart(P[0]);
      const u = G.norm(atEnd ? G.primEndTangent(P[P.length - 1]) : G.mul(G.primStartTangent(P[0]), -1));
      const cutRaw = atEnd
        ? rawPrims.find((p) => p.fillet === undefined && p.edge === P[P.length - 1].vEnd)
        : rawPrims.find((p) => p.fillet === undefined && p.vEnd === P[0].vStart);
      const holedRaw = rawPrims.find((p) => p.fillet === undefined && p.edge === edgePrim.edge);
      if (!cutRaw || !holedRaw || cutRaw === holedRaw) return;
      const ray = { type: 'line', a: E, b: G.add(E, u) };
      let t = null;
      let at = null;
      G.intersections(ray, cutRaw).forEach((pt) => {
        const tt = G.dot(G.sub(pt, E), u);
        if (tt > -1e-6 && (t === null || tt < t)) {
          t = tt;
          at = pt;
        }
      });
      if (t === null) return;
      const tan = cutRaw.type === 'line' ? G.norm(G.sub(cutRaw.b, cutRaw.a)) : G.norm({ x: -(at.y - cutRaw.c.y), y: at.x - cutRaw.c.x });
      const sin = Math.abs(G.cross(u, tan));
      if (sin < 0.15) return; // edge runs almost along the holes: leave it
      const g = holeRadius / sin;
      out[which] = { E, u, t, g, at, cutRaw, holedRaw, reach: Math.max(0, t - g - MARGIN) };
    });
    return out;
  }

  // For each open end that isn't pinned: whether the next hole of the
  // pattern would be cut by the edge without holes, and where that edge
  // could go instead. Distances run from the pattern's anchor nearest
  // that end (a corner hole, the origin, or the run's start), which stays
  // put when the edge moves:
  //   cross    where the edge crosses the line of holes
  //   targets  crossings that clear every hole, nearest first
  function openEnds(run, laid, info, contour, spacing) {
    if (run.closed || !laid.positions.length) return [];
    const L = laid.length;
    const out = [];
    ['end', 'start'].forEach((which) => {
      const e = info[which];
      if (!e || laid.fixed[which]) return;
      const atEnd = which === 'end';
      const pos = laid.positions;
      const base = laid.pinned[which];
      const last = atEnd ? pos[pos.length - 1] - base : base - pos[0];
      const next = last + spacing;
      const cross = atEnd ? L + e.t - base : base + e.t;
      const beyond = atEnd ? L - base : base; // from the anchor to the run's end
      const g = e.g;
      const clear = g + MARGIN + 0.01; // a hair more, so rounding stays clear
      const targets = [next + clear];
      if (next - clear >= last + clear) targets.push(next - clear);
      targets.sort((a, b) => Math.abs(a - cross) - Math.abs(b - cross));
      const hu = G.norm(atEnd ? G.primEndTangent(e.holedRaw) : G.mul(G.primStartTangent(e.holedRaw), -1));
      const cutRef = segOf(contour, e.cutRaw.edge).ref || null;
      const holedRef = segOf(contour, e.holedRaw.edge).ref || null;
      out.push({
        which,
        key: `${cutRef || `e${e.cutRaw.edge}`}|${holedRef || `e${e.holedRaw.edge}`}`,
        cutRef,
        holedRef,
        cutPrim: e.cutRaw,
        holedPrim: e.holedRaw,
        corner: atEnd ? G.primStart(e.cutRaw) : G.primEnd(e.cutRaw),
        dir: hu,
        cross,
        crossPt: e.at,
        holePt: G.add(e.E, G.mul(e.u, next - beyond)),
        conflict: next < cross + g + MARGIN - 1e-6, // touching counts
        targets,
      });
    });
    return out;
  }

  // settings: { holeDiameter, spacing, edgeDistance, stitchOffset }
  // opts: { isOutline, origin: {x, y} | null }
  // The origin snaps to the nearest hole run or stitch line of the contour.
  // On a hole run a hole always lands on it; on a stitch line it is marked
  // with a short tick across the line.
  function layoutContour(contour, settings, opts) {
    const prims = G.buildPrimitives(contour);
    const res = { contour, prims, holes: [], holePaths: [], stitch: [], sections: [], origin: null, openEnds: [] };
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
      const info = endInfo(run, prims, settings.holeDiameter / 2);
      const reach = { start: info.start ? info.start.reach : 0, end: info.end ? info.end.reach : 0 };
      const r = layoutRun(run, contour, settings.spacing, s, reach);
      res.holes = res.holes.concat(r.points);
      res.holePaths.push({ prims: r.path, closed: run.closed });
      res.openEnds = res.openEnds.concat(openEnds(run, r, info, contour, settings.spacing));
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
