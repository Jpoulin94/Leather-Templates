// Project data model, shape helpers and unit conversion.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});

  const VERSION = 2;

  const UNITS = {
    mm: { label: 'mm', factor: 1, decimals: 2 },
    in: { label: 'in', factor: 25.4, decimals: 3 },
  };

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function seg(type, props) {
    return { type, mode: 'none', fillet: 0, corner: true, ...props };
  }

  function newContour() {
    return { start: null, segments: [], closing: { mode: 'none', fillet: 0, corner: true } };
  }

  // Rectangle with its lower-left corner at (x, y), drawn counter-clockwise.
  function rectangle(w, h, radius = 0, x = 0, y = 0, mode = 'none') {
    const c = newContour();
    c.start = { x, y };
    c.segments = [
      seg('line', { length: w, angle: 0, fillet: radius, mode }),
      seg('line', { length: h, angle: 90, fillet: radius, mode }),
      seg('line', { length: w, angle: 180, fillet: radius, mode }),
      seg('line', { length: h, angle: 270, fillet: radius, mode }),
    ];
    c.closing = { mode, fillet: radius, corner: true };
    return c;
  }

  // Circle centred on (cx, cy).
  function circle(r, cx = 0, cy = 0, mode = 'none') {
    const c = newContour();
    c.start = { x: cx + r, y: cy };
    c.segments = [seg('arc', { radius: r, sweep: 360, angle: 90, mode })];
    return c;
  }

  // A piece: its base outline, notches cut into outline edges, and shapes
  // (`cutouts`). A shape's `op` says how it is used: 'hole' (a cutout inside
  // the piece) or 'cut' / 'merge' / 'overlap' with the outline. Notches and
  // combined shapes stay editable; js/resolve.js builds the final result.
  // The outline, each shape and each stitch path may carry origin points
  // (`origins`: [{ id, name, x, y }]). Stitch paths (`paths`) are lines of
  // holes or stitching drawn on the piece that cut nothing.
  function newPiece(name, outline) {
    return {
      id: uid(),
      name,
      outline: outline || rectangle(100, 60, 0, 0, 0, 'holes'),
      notches: [],
      cutouts: [],
      lines: [],
      paths: [],
    };
  }

  // A stitch path through `points`; corners[k] holds the bend at point k.
  function newPath(points, closed = false, mode = 'holes') {
    return { id: uid(), points: points.map((p) => ({ x: p.x, y: p.y })), closed, mode, corners: {}, origins: [] };
  }

  // Origin points of a contour or path (older files kept a single `origin`).
  function originsOf(c) {
    if (!c) return [];
    if (Array.isArray(c.origins)) return c.origins;
    return c.origin ? [{ id: 'origin', name: 'A', x: c.origin.x, y: c.origin.y }] : [];
  }

  // Every origin of a piece with the thing that holds it.
  function pieceOrigins(pc) {
    const out = [];
    const add = (owner, kind, c) => originsOf(c).forEach((o) => out.push({ o, owner, kind, holder: c }));
    add('outline', 'outline', pc.outline);
    (pc.cutouts || []).forEach((c) => add(c.id, 'shape', c));
    (pc.paths || []).forEach((p) => add(p.id, 'path', p));
    return out;
  }

  // The next free origin name in a piece: A, B, C… then A2, B2…
  function nextOriginName(pc) {
    const used = new Set(pieceOrigins(pc).map((x) => String(x.o.name || '').toUpperCase()));
    for (let round = 1; ; round++) {
      for (let i = 0; i < 26; i++) {
        const name = String.fromCharCode(65 + i) + (round > 1 ? round : '');
        if (!used.has(name)) return name;
      }
    }
  }

  // Move every origin of a contour or path with fn(point).
  function mapOrigins(c, fn) {
    if (!c) return;
    c.origins = originsOf(c).map((o) => ({ ...o, ...fn(o) }));
    delete c.origin;
  }

  // A cut line across the outline (target 'outline') or a shape (its id).
  function newLine(a, b, target = 'outline') {
    return { id: uid(), target, a, b, remove: null, mode: 'none', corners: { a: { fillet: 0, corner: true }, b: { fillet: 0, corner: true } } };
  }

  // Rounded slot (a rectangle with round ends) centred on (cx, cy); the
  // ends are on the short sides.
  function slot(w, h, cx = 0, cy = 0, mode = 'none') {
    const c = newContour();
    if (h >= w) {
      const r = w / 2;
      const L = h - w;
      c.start = { x: cx + r, y: cy - L / 2 };
      c.segments = [
        seg('line', { length: L, angle: 90, mode }),
        seg('arc', { radius: r, sweep: 180, angle: 90, mode }),
        seg('line', { length: L, angle: 270, mode }),
        seg('arc', { radius: r, sweep: 180, angle: 270, mode }),
      ];
    } else {
      const r = h / 2;
      const L = w - h;
      c.start = { x: cx - L / 2, y: cy - r };
      c.segments = [
        seg('line', { length: L, angle: 0, mode }),
        seg('arc', { radius: r, sweep: 180, angle: 0, mode }),
        seg('line', { length: L, angle: 180, mode }),
        seg('arc', { radius: r, sweep: 180, angle: 180, mode }),
      ];
    }
    if (Math.abs(w - h) < 1e-9) return circle(w / 2, cx, cy, mode);
    return c;
  }

  function newShape(contour, op = 'hole') {
    return { ...contour, id: uid(), op, joins: {} };
  }

  function newNotch(edge, width, depth) {
    return { id: uid(), edge, at: null, width, depth, corners: { L: { fillet: 0, corner: true }, R: { fillet: 0, corner: true } } };
  }

  function newProject(name = 'Untitled project') {
    return {
      version: VERSION,
      name,
      units: 'mm',
      defaults: { holeDiameter: 2, spacing: 4, edgeDistance: 3, stitchOffset: 4 },
      pieces: [newPiece('Piece 1')],
    };
  }

  // Fill in anything missing from an older or hand-edited project file.
  function normalizeProject(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.pieces)) throw new Error('Not a project file');
    const base = newProject(p.name || 'Untitled project');
    const out = { ...base, ...p, defaults: { ...base.defaults, ...(p.defaults || {}) } };
    if (!UNITS[out.units]) out.units = 'mm';
    out.pieces = p.pieces.map((pc, i) => {
      const fixContour = (c) => ({
        ...newContour(),
        ...c,
        segments: (c && c.segments) || [],
        closing: { mode: 'none', fillet: 0, corner: true, ...((c && c.closing) || {}) },
      });
      const outline = fixContour(pc.outline);
      // Version 1 kept a "zero point" as an edge and offset.
      if (pc.zero && pc.zero.enabled && !outline.origin && !(outline.origins || []).length && LT.geom) {
        const pt = LT.geom.pointOnEdge(outline, pc.zero.edge, pc.zero.offset);
        if (pt) outline.origin = { x: pt.x, y: pt.y };
      }
      // One origin each became a list of named origins.
      const names = new Set();
      const fixOrigins = (c) => {
        c.origins = originsOf(c).map((o) => ({ ...o, id: o.id && o.id !== 'origin' ? o.id : uid() }));
        delete c.origin;
        return c;
      };
      const out = {
        ...newPiece(pc.name || `Piece ${i + 1}`),
        ...pc,
        id: pc.id || uid(),
        outline,
        notches: (pc.notches || []).map((n) => ({ ...newNotch(0, 20, 10), ...n, corners: { L: { fillet: 0, corner: true }, R: { fillet: 0, corner: true }, ...(n.corners || {}) } })),
        cutouts: (pc.cutouts || []).map((c) => fixOrigins({ id: uid(), op: 'hole', joins: {}, ...fixContour(c) })),
        lines: (pc.lines || []).filter((l) => l && l.a && l.b).map((l) => ({ ...newLine(l.a, l.b), ...l, corners: { a: { fillet: 0, corner: true }, b: { fillet: 0, corner: true }, ...(l.corners || {}) } })),
        paths: (pc.paths || []).filter((p) => p && Array.isArray(p.points) && p.points.length > 1).map((p) => fixOrigins({ ...newPath(p.points), ...p, corners: { ...(p.corners || {}) } })),
      };
      fixOrigins(out.outline);
      // Give unnamed or clashing origins their own letters.
      pieceOrigins(out).forEach(({ o }) => {
        const key = String(o.name || '').toUpperCase();
        if (!key || names.has(key)) o.name = '';
        else names.add(key);
      });
      pieceOrigins(out).forEach(({ o }) => {
        if (!o.name) {
          o.name = nextOriginName(out);
          names.add(o.name);
        }
      });
      // Stitching sizes are set once per project now.
      delete out.zero;
      delete out.customSettings;
      delete out.settings;
      return out;
    });
    if (!out.pieces.length) out.pieces = [newPiece('Piece 1')];
    out.version = VERSION;
    return out;
  }

  // ---- units -----------------------------------------------------------

  function toUnits(mm, units) {
    return mm / UNITS[units].factor;
  }

  function format(mm, units) {
    const u = UNITS[units];
    const v = mm / u.factor;
    return String(Number(v.toFixed(u.decimals)));
  }

  // Parses "12.5", "3/16", "1 1/2", "1-1/2", optionally followed by a unit
  // ("mm", "in", "\"") that overrides the current unit. Returns mm or NaN.
  function parseLength(text, units) {
    let s = String(text).trim().toLowerCase();
    let factor = UNITS[units].factor;
    const m = s.match(/(mm|in|"|inch|inches)$/);
    if (m) {
      factor = m[1] === 'mm' ? 1 : 25.4;
      s = s.slice(0, -m[1].length).trim();
    }
    if (!s) return NaN;
    let v;
    const mixed = s.match(/^(-?\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/);
    const frac = s.match(/^(-?\d+)\/(\d+)$/);
    if (mixed) {
      const whole = Number(mixed[1]);
      const f = Number(mixed[2]) / Number(mixed[3]);
      v = whole < 0 ? whole - f : whole + f;
    } else if (frac) {
      v = Number(frac[1]) / Number(frac[2]);
    } else if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) {
      v = Number(s);
    } else {
      return NaN;
    }
    return Number.isFinite(v) ? v * factor : NaN;
  }

  function parseNumber(text) {
    const s = String(text).trim();
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  LT.model = {
    VERSION,
    UNITS,
    uid,
    seg,
    newContour,
    rectangle,
    circle,
    newPiece,
    newShape,
    newNotch,
    newLine,
    newPath,
    originsOf,
    pieceOrigins,
    nextOriginName,
    mapOrigins,
    slot,
    newProject,
    normalizeProject,
    toUnits,
    format,
    parseLength,
    parseNumber,
  };
})(typeof window !== 'undefined' ? window : globalThis);
