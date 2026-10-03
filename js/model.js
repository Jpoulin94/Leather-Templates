// Project data model, shape helpers and unit conversion.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});

  const VERSION = 1;

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

  function newPiece(name, outline) {
    return {
      id: uid(),
      name,
      outline: outline || rectangle(100, 60, 0, 0, 0, 'holes'),
      cutouts: [],
      zero: { enabled: false, edge: 0, offset: 0 },
      customSettings: false,
      settings: {},
    };
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
      return {
        ...newPiece(pc.name || `Piece ${i + 1}`),
        ...pc,
        id: pc.id || uid(),
        outline: fixContour(pc.outline),
        cutouts: (pc.cutouts || []).map(fixContour),
        zero: { enabled: false, edge: 0, offset: 0, ...(pc.zero || {}) },
        settings: pc.settings || {},
      };
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
    newProject,
    normalizeProject,
    toUnits,
    format,
    parseLength,
    parseNumber,
  };
})(typeof window !== 'undefined' ? window : globalThis);
