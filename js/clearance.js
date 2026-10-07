// Edges without holes that cut through the line of holes, and sides that
// don't divide evenly at the set spacing (see the second half).
//
// Where a run of holes ends at an edge without holes, the holes keep their
// exact spacing and the edge is ignored (see layout.js). If that edge
// crosses the line of holes right where the next hole of the pattern
// would be, a piece stacked on this one would have that hole cut in half.
// This finds those edges and works out how far to slide each one, along
// the holed edge, so it clears the hole.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});
  const G = LT.geom;

  // Can the edge a resolved ref points at be slid? Base outline edges,
  // shape edges and lines can; notches and joins can't.
  function movable(ref) {
    return /^o:\d+$/.test(ref || '') || /^c:.+:\d+$/.test(ref || '') || /^l:[^:]+$/.test(ref || '');
  }

  const whereOf = (c, i) => (i === 0 ? 'outline' : c.src || `cut${i}`);

  // Every open end of every contour in a laid-out piece, each with an id
  // that stays the same while its edge moves.
  function endsOf(lay) {
    const out = [];
    [lay.outline, ...lay.cutouts].forEach((c, i) => {
      const where = whereOf(c, i);
      (c.openEnds || []).forEach((e) => out.push({ ...e, where, id: `${where}|${e.which}|${e.key}` }));
    });
    return out;
  }

  // Slide the edge at an open end by delta mm along the holed edge
  // (positive = away from the holes, so the holed edge gets longer).
  // Mutates the piece. Returns false if that edge can't be moved.
  function moveEnd(piece, end, delta) {
    const ref = end.cutRef || '';
    const v = G.mul(end.dir, delta);
    let m = ref.match(/^o:(\d+)$/);
    if (m) {
      const ok = LT.resolve.shiftEdge(piece.outline, Number(m[1]), v);
      if (ok) LT.model.mapOrigins(piece.outline, (o) => (G.dist(o, end.corner) < 1e-6 ? G.add(o, v) : o));
      return ok;
    }
    m = ref.match(/^c:(.+):(\d+)$/);
    if (m) {
      const sh = (piece.cutouts || []).find((c) => c.id === m[1]);
      return !!sh && LT.resolve.shiftEdge(sh, Number(m[2]), v);
    }
    m = ref.match(/^l:([^:]+)$/);
    if (m) {
      const line = (piece.lines || []).find((l) => l.id === m[1]);
      const rep = LT.resolve.resolvePiece(piece).report.lines[m[1]];
      if (!line || !rep || !rep.ok) return false;
      // Pin the line to where it meets the edges, then slide the end at
      // this corner; the other end keeps its kept length.
      const nearP = G.dist(rep.P, end.corner) <= G.dist(rep.Q, end.corner);
      line.a = nearP ? G.add(rep.P, v) : { ...rep.P };
      line.b = nearP ? { ...rep.Q } : G.add(rep.Q, v);
      return true;
    }
    return false;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function endAfter(project, piece, end, delta) {
    const pc = clone(piece);
    if (!moveEnd(pc, end, delta)) return null;
    const lay = LT.layout.layoutPiece(project, pc);
    return endsOf(lay).find((e) => e.id === end.id) || null;
  }

  // How far to slide the edge so it crosses the line of holes at `target`
  // (a distance measured the same way as end.cross). The crossing moves
  // almost linearly with the edge, so a few secant steps are plenty. A
  // slanted edge that turns as it moves shifts the target a little, so the
  // target is re-read each step.
  function solve(project, piece, end, target) {
    let d0 = 0;
    let c0 = end.cross;
    let d1 = target - end.cross;
    for (let it = 0; it < 8; it++) {
      const e = endAfter(project, piece, end, d1);
      if (!e) return null;
      if (!e.conflict && Math.abs(e.cross - target) < 0.05) return d1;
      if (e.conflict && e.targets.length) target = e.targets.reduce((b, t) => (Math.abs(t - target) < Math.abs(b - target) ? t : b));
      const slope = (e.cross - c0) / (d1 - d0);
      if (!isFinite(slope) || Math.abs(slope) < 1e-6) return null;
      d0 = d1;
      c0 = e.cross;
      d1 = d1 + (target - e.cross) / slope;
    }
    return null;
  }

  // Edges that cut through a hole, with up to two suggested slides
  // (nearest first) that clear it.
  function check(project, piece, lay) {
    lay = lay || LT.layout.layoutPiece(project, piece);
    return endsOf(lay)
      .filter((e) => e.conflict)
      .map((e) => {
        const can = movable(e.cutRef);
        const fixes = [];
        if (can) {
          e.targets.forEach((t) => {
            const d = solve(project, piece, e, t);
            if (d !== null && !fixes.some((f) => Math.abs(f - d) < 1e-3)) fixes.push(Math.sign(d) * Math.ceil(Math.abs(d) * 100 - 1e-6) / 100);
          });
        }
        return { ...e, movable: can, fixes };
      });
  }

  // ---------------------------------------------------------------------
  // Sides that don't divide evenly. Spacing never stretches, so between two
  // holes that are pinned (corner holes, origins, path ends) whatever is
  // left over is never a short gap: the corner hole at that end is left out
  // (`dropped`). Only between two origins, or round a closed run with no
  // corners, is a short gap left. Two ways to make the side fit, so the
  // hole comes back, keeping the holes the same distance from every edge:
  //   outline   make the side longer (slide the edge across the corner, or
  //             move the stitch path's point)
  //   distance  a shorter holes-from-edge for the whole project

  const segOf = (contour, i) => (i < contour.segments.length ? contour.segments[i] : contour.closing) || {};

  // Every uneven section, with what's needed to fix it.
  function unevenOf(lay) {
    const out = [];
    LT.layout.allOf(lay).forEach((c, i) => {
      const where = c.kind === 'path' ? c.src : whereOf(c, i);
      c.sections.forEach((sec) => {
        if (!sec.uneven && !sec.dropped) return;
        const v = sec.oddVertex;
        const at = sec.oddEnd === 'to' ? sec.to : sec.from;
        const L = G.pathLength(sec.path);
        const wrap = (x) => (sec.closed ? ((x % L) + L) % L : Math.max(0, Math.min(L, x)));
        const pt = G.pathPointAt(sec.path, wrap(at));
        // Along the section, pointing out through the short gap's end
        // (read just inside the section, not round the corner).
        const back = sec.oddEnd === 'to' ? at - Math.min(0.5, sec.length / 2) : at + Math.min(0.5, sec.length / 2);
        const inside = G.pathPointAt(sec.path, wrap(back));
        const dir = G.norm(G.sub(pt, inside));
        // The section's own edge and the edge across the corner.
        let own = null;
        let across = null;
        if (v !== null && v !== undefined && c.kind !== 'path') {
          const prev = c.prims.find((p) => p.fillet === undefined && p.vEnd === v);
          const next = c.prims.find((p) => p.fillet === undefined && p.edge === v);
          const [o, a] = sec.oddEnd === 'to' ? [prev, next] : [next, prev];
          own = o ? { ref: segOf(c.contour, o.edge).ref || null, prim: o } : null;
          across = a ? { ref: segOf(c.contour, a.edge).ref || null, prim: a } : null;
        }
        const vref = v !== null && v !== undefined ? segOf(c.contour, v).vref || null : null;
        out.push({
          id: `${where}|${vref || (v === null || v === undefined ? 'none' : `v${v}`)}|${sec.oddEnd}`,
          vref,
          where,
          isPath: c.kind === 'path',
          section: sec,
          length: sec.length,
          gap: sec.gap,
          dropped: !!sec.dropped,
          oddKind: sec.oddKind,
          vertex: v,
          pt,
          dir,
          own,
          across,
        });
      });
    });
    return out;
  }

  // Change the piece for one kind of fix. Mutates the piece.
  //   'outline'  slide the edge across the corner by amount mm, making the
  //              side longer (positive) or shorter
  //   'point'    the same for a stitch path: move its point at the corner
  // (A new holes-from-edge is a project setting: see `distanceFixes`.)
  function applyFix(piece, u, kind, amount) {
    if (kind === 'point') {
      const path = (piece.paths || []).find((p) => p.id === u.where);
      if (!path || u.vertex === null) return false;
      const k = Math.min(u.vertex, path.points.length - 1);
      path.points[k] = G.add(path.points[k], G.mul(u.dir, amount));
      LT.model.mapOrigins(path, (o) => o);
      return true;
    }
    if (kind === 'outline') {
      if (!u.across || !u.across.ref) return false;
      const corner = u.across.prim ? (u.section.oddEnd === 'to' ? G.primStart(u.across.prim) : G.primEnd(u.across.prim)) : u.pt;
      return moveEnd(piece, { cutRef: u.across.ref, dir: u.dir, corner }, amount);
    }
    return false;
  }

  // The same section in another layout of the piece: its length, and
  // whether it now divides evenly.
  function sectionIn(lay, u) {
    const same = unevenOf(lay).find((x) => x.id === u.id);
    if (same) return { length: same.length, even: false };
    let found = null;
    LT.layout.allOf(lay).forEach((c, i) => {
      const where = c.kind === 'path' ? c.src : whereOf(c, i);
      if (where !== u.where) return;
      c.sections.forEach((sec) => {
        if (sec.oddVertex === u.vertex && sec.oddEnd === u.section.oddEnd) found = sec;
      });
    });
    return found ? { length: found.length, even: !found.uneven && !found.dropped } : null;
  }

  const withDistance = (project, e) => ({ ...project, defaults: { ...project.defaults, edgeDistance: e } });

  function sectionAfter(project, piece, u, kind, amount) {
    if (kind === 'distance') return sectionIn(LT.layout.layoutPiece(withDistance(project, amount), piece), u);
    const pc = clone(piece);
    if (!applyFix(pc, u, kind, amount)) return null;
    return sectionIn(LT.layout.layoutPiece(project, pc), u);
  }

  // Secant steps to make the section `target` long.
  function solveFix(project, piece, u, kind, start, target) {
    let x0 = start;
    let f0 = u.length;
    let x1 = kind === 'distance' ? start - (target - u.length) / 2 : start + (target - u.length);
    for (let it = 0; it < 8; it++) {
      const r = sectionAfter(project, piece, u, kind, x1);
      if (!r) return null;
      if (Math.abs(r.length - target) < 0.002) return r.even ? x1 : null;
      const slope = (r.length - f0) / (x1 - x0);
      if (!isFinite(slope) || Math.abs(slope) < 1e-6) return null;
      x0 = x1;
      f0 = r.length;
      x1 = x1 + (target - r.length) / slope;
    }
    return null;
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const MIN_DISTANCE = 0.5; // mm: the least holes-from-edge offered

  // Shorter holes-from-edge values (for every edge of the project) that
  // even out side `u`, nearest first, stopping at the first that evens out
  // every side of the piece. `left`: sides of this piece still uneven.
  function distanceFixes(project, piece, u) {
    if (u.isPath) return [];
    const s = project.defaults.spacing;
    const cur = project.defaults.edgeDistance;
    const out = [];
    for (let k = 1; k <= 40; k++) {
      const target = Math.floor(u.length / s + 1e-9) * s + k * s;
      const e = solveFix(project, piece, u, 'distance', cur, target);
      if (e === null) continue;
      if (e < MIN_DISTANCE) break;
      if (e >= cur - 1e-6) continue;
      const amount = Math.round(e * 1000) / 1000;
      const lay = LT.layout.layoutPiece(withDistance(project, amount), piece);
      if (unevenOf(lay).some((x) => x.id === u.id)) continue;
      const left = unevenOf(lay).filter((x) => !x.isPath).length;
      if (!out.length || !left) out.push({ amount, kind: 'distance', left });
      if (!left) break;
    }
    return out;
  }

  // Sides that don't fit (a corner hole left out, or a short gap) with
  // their fixes:
  //   outline: [{ amount }]    make the side (or leg) this much longer
  //   distance: [{ amount, left }]  a shorter holes-from-edge
  function uneven(project, piece, lay) {
    lay = lay || LT.layout.layoutPiece(project, piece);
    const s = project.defaults.spacing;
    return unevenOf(lay).map((u) => {
      const fix = { outline: [], distance: [] };
      const moveKind = u.isPath ? 'point' : 'outline';
      if (u.isPath ? u.vertex !== null : u.across && movable(u.across.ref)) {
        const t = Math.floor(u.length / s + 1e-9) * s + s;
        const d = solveFix(project, piece, u, moveKind, 0, t);
        if (d !== null && d > 0) fix.outline.push({ amount: r2(d), kind: moveKind });
      }
      fix.distance = distanceFixes(project, piece, u);
      return { ...u, fix };
    });
  }

  LT.clearance = { movable, endsOf, moveEnd, solve, check, unevenOf, uneven, applyFix, distanceFixes };
})(typeof window !== 'undefined' ? window : globalThis);
