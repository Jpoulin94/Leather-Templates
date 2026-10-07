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

  const TOL = 0.01; // mm: a gap this close to the spacing counts as exact

  // Holes at exactly `spacing` between two anchors that both get a hole.
  // The pattern starts from an origin if one end is an origin, otherwise
  // from the first anchor; whatever is left over shows up as one short
  // gap at the other end (`gap`, with `uneven` set).
  function fit(A, B, spacing) {
    const length = B.s - A.s;
    const back = B.kind === 'origin' && A.kind !== 'origin';
    const n = Math.floor((length + TOL) / spacing);
    let rem = length - n * spacing;
    const pos = [];
    for (let k = 0; k <= n; k++) pos.push(back ? B.s - k * spacing : A.s + k * spacing);
    if (rem > TOL) pos.push(back ? A.s : B.s);
    if (rem <= TOL) rem = 0;
    const odd = back ? A : B;
    return {
      pos,
      length,
      actual: spacing,
      gap: rem,
      uneven: rem > TOL && rem < spacing - TOL,
      oddEnd: back ? 'from' : 'to',
      oddKind: odd.kind,
      oddVertex: odd.kind === 'corner' || odd.kind === 'end' ? odd.v : null,
    };
  }

  // reach: how far holes may run on past each open end ({ start, end }, mm).
  // opts.anchorEnds: both ends of an open run get a hole (stitch paths),
  // unless an origin is on the run.
  function layoutRun(run, contour, spacing, origins, reach, opts) {
    reach = reach || { start: 0, end: 0 };
    opts = opts || {};
    if (origins === null || origins === undefined) origins = [];
    else if (!Array.isArray(origins)) origins = [origins];
    const prims = run.prims;
    const cum = [0];
    prims.forEach((p) => cum.push(cum[cum.length - 1] + G.primLength(p)));
    const L = cum[cum.length - 1];
    const corner = (v) => G.vertexProps(contour, v).corner;

    const anchors = [];
    for (let j = 1; j < prims.length; j++) {
      if (isSharp(prims[j - 1], prims[j]) && corner(prims[j].vStart)) anchors.push({ s: cum[j], kind: 'corner', v: prims[j].vStart });
    }
    if (run.closed && isSharp(prims[prims.length - 1], prims[0]) && corner(prims[0].vStart)) {
      anchors.push({ s: 0, kind: 'corner', v: prims[0].vStart });
    }
    origins.forEach((o) => anchors.push({ s: o, kind: 'origin' }));
    if (!run.closed && opts.anchorEnds && !origins.length) {
      anchors.push({ s: 0, kind: 'end', v: prims[0].vStart }, { s: L, kind: 'end', v: prims[prims.length - 1].vEnd });
    }
    anchors.sort((a, b) => a.s - b.s);
    // An origin on a corner is still that corner's hole; keep the origin.
    const uniq = [];
    anchors.forEach((a) => {
      const last = uniq[uniq.length - 1];
      if (last && a.s - last.s < 1e-6) {
        if (a.kind === 'origin') uniq[uniq.length - 1] = { ...last, kind: 'origin' };
      } else uniq.push(a);
    });

    const sections = [];
    const fixed = { start: true, end: true };
    const pinned = { start: 0, end: L }; // pattern anchor nearest each end
    let positions = [];
    const section = (A, B, closed) => {
      const r = fit(A, B, spacing);
      sections.push({ ...r, from: A.s, to: B.s, path: prims, closed });
      return r.pos;
    };
    if (run.closed) {
      if (!uniq.length) uniq.push({ s: 0, kind: 'start' });
      uniq.forEach((a, i) => {
        const b = i + 1 < uniq.length ? uniq[i + 1] : { ...uniq[0], s: uniq[0].s + L };
        positions = positions.concat(section(a, b, true));
      });
      positions = positions.map((x) => ((x % L) + L) % L);
    } else {
      // Open ends: exact spacing outward from the nearest anchor.
      const inner = uniq.filter((a) => a.s > -1e-6 && a.s < L + 1e-6);
      // No anchors: the pattern starts at the run's start (inset by half a
      // spacing when that corner's hole is switched off).
      if (!inner.length) inner.push({ s: Math.min(L, corner(prims[0].vStart) ? 0 : spacing / 2), kind: 'start' });
      // An end where the pattern is pinned is never checked for clearance.
      fixed.start = !uniq.length || inner[0].s < 1e-6;
      fixed.end = inner[inner.length - 1].s > L - 1e-6;
      pinned.start = inner[0].s;
      pinned.end = inner[inner.length - 1].s;
      const first = inner[0].s;
      const last = inner[inner.length - 1].s;
      const exact = (from, to, dir) => {
        const pos = [];
        for (let x = from; dir > 0 ? x <= to + 1e-6 : x >= to - 1e-6; x += dir * spacing) pos.push(x);
        return pos;
      };
      if (!fixed.start) {
        positions = positions.concat(exact(first, -reach.start, -1));
        if (first > 1e-6) sections.push({ pos: [], actual: spacing, gap: 0, uneven: false, length: first, from: 0, to: first, path: prims, closed: false });
      }
      for (let i = 0; i + 1 < inner.length; i++) positions = positions.concat(section(inner[i], inner[i + 1], false));
      positions = positions.concat(exact(last, fixed.end ? L : L + reach.end, 1));
      if (L - last > 1e-6) sections.push({ pos: [], actual: spacing, gap: 0, uneven: false, length: L - last, from: last, to: L, path: prims, closed: false });
    }
    positions.sort((a, b) => a - b);
    const dedup = positions.filter((x, i) => i === 0 || x - positions[i - 1] > 1e-6);
    if (run.closed && dedup.length > 1 && L - dedup[dedup.length - 1] + dedup[0] < 1e-6) dedup.pop();
    return { points: dedup.map((x) => pointAt(prims, L, x)), positions: dedup, sections, path: prims, length: L, fixed, pinned };
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
    const res = { contour, prims, holes: [], holePaths: [], stitch: [], sections: [], origin: null, origins: [], openEnds: [] };
    if (!prims.length) return res;
    const ccw = G.signedArea(prims) > 0;
    const side = opts.isOutline === ccw ? 1 : -1; // +1: material is on the left

    let holeRuns = [];
    if (prims.some((p) => p.mode === 'holes') && settings.spacing > 0) {
      // Each edge can have its own distance from the edge to its holes.
      const d = opts.path ? 0 : (p) => side * ((p.edgeDist ?? settings.edgeDistance) + settings.holeDiameter / 2);
      holeRuns = findRuns(G.offsetPrims(prims, d), 'holes');
    }
    if (prims.some((p) => p.mode === 'stitch')) {
      res.stitch = findRuns(G.offsetPrims(prims, opts.path ? 0 : side * settings.stitchOffset), 'stitch');
    }

    // Origins snap to the nearest hole run or stitch line of the contour.
    const list = opts.origins || (opts.origin ? [{ ...opts.origin, id: 'origin', name: '' }] : []);
    const snapped = list
      .map((o) => {
        let best = null;
        const consider = (run, kind, i) => {
          const n = G.nearestOnPath(run.prims, o);
          if (n && (!best || n.d < best.d)) best = { ...n, kind, i };
        };
        holeRuns.forEach((r, i) => consider(r, 'hole', i));
        res.stitch.forEach((r, i) => consider(r, 'stitch', i));
        return best && { ...best, id: o.id, name: o.name || '' };
      })
      .filter(Boolean);

    holeRuns.forEach((run, i) => {
      const os = snapped.filter((b) => b.kind === 'hole' && b.i === i).map((b) => b.s);
      const info = opts.path ? { start: null, end: null } : endInfo(run, prims, settings.holeDiameter / 2);
      const reach = { start: info.start ? info.start.reach : 0, end: info.end ? info.end.reach : 0 };
      const r = layoutRun(run, contour, settings.spacing, os, reach, { anchorEnds: !!opts.path });
      res.holes = res.holes.concat(r.points);
      res.holePaths.push({ prims: r.path, closed: run.closed });
      res.openEnds = res.openEnds.concat(openEnds(run, r, info, contour, settings.spacing));
      r.sections.forEach((sec) => res.sections.push({ ...sec, requested: settings.spacing }));
    });

    res.origins = snapped.map((b) => {
      const run = b.kind === 'hole' ? holeRuns[b.i] : res.stitch[b.i];
      const ahead = G.pathPointAt(run.prims, Math.min(G.pathLength(run.prims), b.s + 0.01));
      const behind = G.pathPointAt(run.prims, Math.max(0, b.s - 0.01));
      return { id: b.id, name: b.name, kind: b.kind, pt: G.pathPointAt(run.prims, b.s), tangent: G.norm(G.sub(ahead, behind)) };
    });
    res.origin = res.origins[0] || null;
    return res;
  }

  function pieceSettings(project) {
    return { ...project.defaults };
  }

  // A stitch path as a contour: one edge per leg, plus a closing edge that
  // carries nothing when the path is open.
  function pathContour(path) {
    const pts = path.points || [];
    const n = pts.length;
    const corner = (k) => ({ fillet: 0, corner: true, ...((path.corners || {})[k] || {}) });
    const segments = [];
    for (let k = 0; k + 1 < n; k++) {
      const d = G.sub(pts[k + 1], pts[k]);
      const c = corner(k);
      segments.push({
        type: 'line',
        length: G.len(d),
        angle: ((G.deg(Math.atan2(d.y, d.x)) % 360) + 360) % 360,
        mode: path.mode || 'holes',
        fillet: !path.closed && k === 0 ? 0 : Number(c.fillet) || 0,
        corner: c.corner !== false,
        ref: `p:${path.id}:${k}`,
        vref: `p:${path.id}:${k}`,
      });
    }
    const last = corner(n - 1);
    const closing = path.closed
      ? { mode: path.mode || 'holes', fillet: Number(last.fillet) || 0, corner: last.corner !== false, ref: `p:${path.id}:${n - 1}`, vref: `p:${path.id}:${n - 1}` }
      : { mode: 'none', fillet: 0, corner: true };
    return { start: n ? { x: pts[0].x, y: pts[0].y } : null, segments, closing };
  }

  function layoutPiece(project, piece) {
    const settings = pieceSettings(project);
    const resolved = LT.resolve.resolvePiece(piece);
    const empty = { start: null, segments: [], closing: { mode: 'none', fillet: 0, corner: true } };
    const outline = layoutContour(resolved.outline || empty, settings, { isOutline: true, origins: LT.model.originsOf(piece.outline) });
    const cutouts = resolved.cutouts.map((c) => ({
      ...layoutContour(c.contour, settings, { isOutline: false, origins: c.origins || [] }),
      src: c.src,
    }));
    const paths = (piece.paths || [])
      .filter((p) => (p.points || []).length > 1)
      .map((p) => ({
        ...layoutContour(pathContour(p), settings, { isOutline: true, path: true, origins: LT.model.originsOf(p) }),
        src: p.id,
        kind: 'path',
        closed: !!p.closed,
      }));
    return { settings, outline, cutouts, paths, holeRadius: settings.holeDiameter / 2, resolved };
  }

  // Everything laid out on a piece that can carry holes or stitching.
  const allOf = (lay) => [lay.outline, ...lay.cutouts, ...(lay.paths || [])];

  // Bounding box of everything that gets drawn for a laid-out piece.
  function pieceBBox(lay) {
    const all = allOf(lay);
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

  LT.layout = { originTick, findRuns, layoutContour, layoutPiece, pathContour, allOf, pieceSettings, pieceBBox };
})(typeof window !== 'undefined' ? window : globalThis);
