// Edges without holes that cut through the line of holes.
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

  // Every open end of every contour in a laid-out piece, each with an id
  // that stays the same while its edge moves.
  function endsOf(lay) {
    const out = [];
    [lay.outline, ...lay.cutouts].forEach((c, i) => {
      const where = i === 0 ? 'outline' : c.src || `cut${i}`;
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
      if (ok && piece.outline.origin && G.dist(piece.outline.origin, end.corner) < 1e-6) {
        piece.outline.origin = G.add(piece.outline.origin, v);
      }
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

  LT.clearance = { movable, endsOf, moveEnd, solve, check };
})(typeof window !== 'undefined' ? window : globalThis);
