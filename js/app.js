// User interface: canvas editor, selection, inspector, saving and export.
//
// The canvas shows each piece as resolved by js/resolve.js. Every edge and
// corner on screen carries a reference back to where its settings live (the
// base outline, a notch, a shape, or a corner made by combining shapes), so
// clicking it edits the right thing and everything stays editable.
(function () {
  'use strict';
  const { model: M, geom: G, layout: Lay, render: R, pdf: P, storage: S, resolve: RS } = window.LT;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = R.escapeXml;
  const MODE_LABEL = { holes: 'Holes', stitch: 'Stitch line', none: 'None' };
  const OP_LABEL = { hole: 'Hole', cut: 'Cut away', merge: 'Merge', overlap: 'Overlap' };
  const OP_SUB = {
    hole: 'cut out inside the piece',
    cut: 'cut away from the outline',
    merge: 'merged into the outline',
    overlap: 'only the overlap is kept',
  };
  // Corner colours by radius, so corners with the same rounding match.
  const RADIUS_COLORS = ['#d9480f', '#2f9e44', '#1971c2', '#ae3ec9', '#e8590c', '#0c8599', '#c2255c', '#5c940d'];

  // Icons (24px grid, stroked)
  const ICON = {
    select: '<path d="M5 3l14 8-6 2-3 6z"/>',
    pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    magnet: '<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 010 10h-3"/>',
    redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 000 10h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    corner: '<path d="M5 20V12a7 7 0 017-7h7"/>',
    edge: '<path d="M4 18L20 6"/><circle cx="8" cy="15" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="16" cy="9" r="1.2"/>',
    piece: '<rect x="4" y="5" width="16" height="14" rx="3"/>',
    shape: '<rect x="3" y="7" width="12" height="10" rx="1.5"/><circle cx="15" cy="12" r="5"/>',
    notch: '<path d="M3 7h6a3 3 0 006 0h6v11H3z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    laser: '<path d="M12 3v7M8 6l4 4 4-4"/><rect x="4" y="14" width="16" height="6" rx="1"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    resize: '<path d="M4 9V4h5M20 15v5h-5M4 4l7 7M20 20l-7-7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const icon = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  const pref = (k, d) => {
    try {
      const v = localStorage.getItem(`leather-templates.ui.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  };
  const setPref = (k, v) => {
    try {
      localStorage.setItem(`leather-templates.ui.${k}`, JSON.stringify(v));
    } catch (e) {
      /* private mode */
    }
  };

  let project = S.loadCurrent() || M.newProject();
  const ui = {
    pieceIdx: 0,
    sel: { type: null, items: [] }, // type: 'edge' | 'corner' | 'shape' | 'notch' | null
    tool: 'select', // 'select' | 'draw' | 'round' | 'origin'
    drawTarget: 'outline', // 'outline' or a shape id while drawing
    brush: null, // corner radius (mm) the round tool applies
    snap: true,
    view: null,
    mouse: null,
    shift: false,
    ptr: null,
    dirty: false,
    savedName: null,
    paper: 'letter',
    combine: null, // { id, pieces } while choosing lines
    alignTarget: 'outline',
    advOpen: false,
    stitchOpen: pref('stitchOpen', true),
    checkOpen: false,
    highlight: null, // adjusted spacing section to show on the drawing
    adjusted: [],
  };

  // ---------------------------------------------------------------------
  // Accessors

  const piece = () => project.pieces[ui.pieceIdx];
  const shapeById = (id, pc = piece()) => pc.cutouts.find((c) => c.id === id) || null;
  const shapeNo = (id, pc = piece()) => pc.cutouts.findIndex((c) => c.id === id) + 1;
  const notchById = (id, pc = piece()) => (pc.notches || []).find((n) => n.id === id) || null;
  const units = () => project.units;
  const inch = () => units() === 'in';
  const fmt = (mm) => M.format(mm, units());
  const edgeProps = (c, src) => (src < c.segments.length ? c.segments[src] : c.closing);
  const minorStep = () => (inch() ? 25.4 / 16 : 1);
  const round = (v) => Math.round(v * 10000) / 10000;
  const flip = (p) => ({ x: p.x, y: -p.y });
  const num = (v) => Number(v.toFixed(4));
  const isLiveOp = (sh) => RS.OPS.includes(sh.op);

  function drawContour() {
    const pc = piece();
    if (ui.drawTarget !== 'outline') {
      const sh = shapeById(ui.drawTarget);
      if (sh) return sh;
      ui.drawTarget = 'outline';
    }
    return pc.outline;
  }

  function moveContour(c, dx, dy) {
    if (c.start) c.start = { x: round(c.start.x + dx), y: round(c.start.y + dy) };
    if (c.origin) c.origin = { x: c.origin.x + dx, y: c.origin.y + dy };
  }

  function numInput(attrs, mm) {
    return `<span class="num" data-unit="${units()}"><input type="text" inputmode="decimal" ${attrs} value="${mm === '' || mm === null ? '' : fmt(mm)}"></span>`;
  }

  // Layout of the current piece, cached until the project changes.
  let layCache = { key: null, lay: null };
  function curLay() {
    const key = JSON.stringify([project.defaults, piece()]);
    if (layCache.key !== key) layCache = { key, lay: Lay.layoutPiece(project, piece()) };
    return layCache.lay;
  }

  // ---------------------------------------------------------------------
  // References: where the settings of an edge or corner live.
  //   o:<i>  c:<shape>:<i>  n:<notch>[:L|:R|:x]  j:<shape>:<key>

  function parseRef(ref) {
    const p = String(ref).split(':');
    if (p[0] === 'o') return { kind: 'o', idx: Number(p[1]) };
    if (p[0] === 'c') return { kind: 'c', id: p[1], idx: Number(p[2]) };
    if (p[0] === 'n') return { kind: 'n', id: p[1], side: p[2] || null };
    if (p[0] === 'j') return { kind: 'j', id: p[1], key: p.slice(2).join(':') };
    return { kind: '?' };
  }

  // Object whose .mode controls an edge (null for notch edges, which follow
  // the edge they are cut into).
  function edgeTarget(ref) {
    const r = parseRef(ref);
    const pc = piece();
    if (r.kind === 'o') return edgeProps(pc.outline, r.idx);
    if (r.kind === 'c') {
      const sh = shapeById(r.id);
      return sh ? edgeProps(sh, r.idx) : null;
    }
    return null;
  }

  // Object holding a corner's { fillet, corner }.
  function cornerTarget(vref) {
    const r = parseRef(vref);
    const pc = piece();
    if (r.kind === 'o') return edgeProps(pc.outline, r.idx);
    if (r.kind === 'c') {
      const sh = shapeById(r.id);
      return sh ? edgeProps(sh, r.idx) : null;
    }
    if (r.kind === 'n' && (r.side === 'L' || r.side === 'R')) {
      const n = notchById(r.id);
      if (!n) return null;
      n.corners = n.corners || {};
      n.corners[r.side] = n.corners[r.side] || { fillet: 0, corner: true };
      return n.corners[r.side];
    }
    if (r.kind === 'j') {
      const sh = shapeById(r.id);
      if (!sh) return null;
      sh.joins = sh.joins || {};
      sh.joins[r.key] = sh.joins[r.key] || { fillet: 0, corner: true };
      return sh.joins[r.key];
    }
    return null;
  }

  function refWhere(ref) {
    const r = parseRef(ref);
    if (r.kind === 'o') return 'the outline';
    if (r.kind === 'n') return 'a notch';
    if (r.kind === 'c' || r.kind === 'j') return `shape ${shapeNo(r.id)}`;
    return '';
  }

  // Corners shown on the drawing: { pt, vref, fillet, corner } for each
  // laid-out contour. Smooth joins (no turn) are not corners.
  function cornersOf(lc) {
    const c = lc.contour;
    const edges = G.buildEdges(c);
    const n = edges.length;
    const out = [];
    if (n < 2) return out;
    edges.forEach((e, i) => {
      const prev = edges[(i - 1 + n) % n];
      const vp = G.vertexProps(c, e.edge);
      const seg = edgeProps(c, e.edge);
      const vref = seg && seg.vref;
      if (!vref || /^n:[^:]+:x$/.test(vref)) return;
      const t1 = G.primEndTangent(prev);
      const t2 = G.primStartTangent(e);
      const sharp = Math.acos(Math.max(-1, Math.min(1, G.dot(t1, t2)))) > G.rad(2);
      if (!sharp && !(vp.fillet > 0)) return;
      out.push({ pt: G.primStart(e), vref, fillet: vp.fillet, corner: vp.corner });
    });
    return out;
  }

  function allCorners(lay = curLay()) {
    return [lay.outline, ...lay.cutouts].flatMap((lc) => cornersOf(lc));
  }

  // Distinct radii in use on this piece, for colours and the legend.
  function radiiInUse(lay = curLay()) {
    const list = [];
    allCorners(lay).forEach((c) => {
      if (c.fillet > 0 && !list.some((r) => Math.abs(r - c.fillet) < 1e-6)) list.push(c.fillet);
    });
    return list.sort((a, b) => a - b);
  }
  function radiusColor(r, list) {
    const i = list.findIndex((x) => Math.abs(x - r) < 1e-6);
    return i < 0 ? 'var(--accent)' : RADIUS_COLORS[i % RADIUS_COLORS.length];
  }

  // ---------------------------------------------------------------------
  // Undo history: snapshots of the project, taken whenever it changes.

  const history = { undo: [], redo: [], last: JSON.stringify(project), limit: 200 };

  function resetHistory() {
    history.undo = [];
    history.redo = [];
    history.last = JSON.stringify(project);
  }

  function commit() {
    const now = JSON.stringify(project);
    if (now !== history.last) {
      history.undo.push(history.last);
      if (history.undo.length > history.limit) history.undo.shift();
      history.redo = [];
      history.last = now;
      ui.dirty = true;
      S.saveCurrent(project);
    }
    renderAll();
  }

  function validateSel() {
    const pc = piece();
    const t = ui.sel.type;
    if (t === 'shape') ui.sel.items = ui.sel.items.filter((id) => shapeById(id));
    else if (t === 'notch') ui.sel.items = ui.sel.items.filter((id) => notchById(id));
    else if (t === 'edge' || t === 'corner') {
      const lay = curLay();
      const live = new Set();
      [lay.outline, ...lay.cutouts].forEach((lc) =>
        lc.contour.segments.forEach((s) => {
          if (t === 'edge' && s.ref) live.add(s.ref);
          if (t === 'corner' && s.vref) live.add(s.vref);
        })
      );
      ui.sel.items = ui.sel.items.filter((r) => live.has(r));
    }
    if (t && !ui.sel.items.length) ui.sel = { type: null, items: [] };
    if (ui.combine && !shapeById(ui.combine.id, pc)) ui.combine = null;
  }

  function restore(snapshot) {
    project = JSON.parse(snapshot);
    history.last = snapshot;
    ui.pieceIdx = Math.min(ui.pieceIdx, project.pieces.length - 1);
    validateSel();
    if (ui.tool === 'draw') ui.tool = 'select';
    ui.combine = null;
    ui.dirty = true;
    S.saveCurrent(project);
    renderAll();
  }

  function undo() {
    if (!history.undo.length) return;
    history.redo.push(history.last);
    restore(history.undo.pop());
  }

  function redo() {
    if (!history.redo.length) return;
    history.undo.push(history.last);
    restore(history.redo.pop());
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------------
  // Dialogs

  function dialog(title, bodyHtml, buttons, onOpen) {
    const dlg = $('#dialog');
    $('#dialogTitle').textContent = title;
    $('#dialogBody').innerHTML = bodyHtml;
    $('#dialogButtons').innerHTML = buttons
      .map((b) => `<button value="${b.value}" class="${b.cls || ''}">${esc(b.label)}</button>`)
      .join('');
    return new Promise((resolve) => {
      const done = () => {
        dlg.removeEventListener('close', done);
        resolve(dlg.returnValue);
      };
      dlg.addEventListener('close', done);
      dlg.returnValue = '';
      // Enter in a field means the main button, not the first one (Cancel).
      dlg.onkeydown = (e) => {
        const primary = $('#dialogButtons .primary', dlg);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && primary) {
          e.preventDefault();
          primary.click();
        }
      };
      dlg.showModal();
      if (onOpen) onOpen(dlg);
      const first = $('input[type=text],select', dlg);
      if (first) {
        first.focus();
        if (first.select) first.select();
      }
    });
  }

  // Ask for lengths. Returns {key: mm} or null.
  async function askLengths(title, fields, okLabel = 'OK') {
    for (;;) {
      const body =
        `<div class="grid2">${fields
          .map((f) => `<label class="fld"><span>${esc(f.label)}</span>${numInput(`id="f_${f.key}"`, f.value)}</label>`)
          .join('')}</div>` +
        `<p class="note">In ${units()}. Fractions like 1 1/2 or 3/16 work too.</p>`;
      const res = await dialog(title, body, [
        { label: 'Cancel', value: 'cancel', cls: 'ghost' },
        { label: okLabel, value: 'ok', cls: 'primary' },
      ]);
      if (res !== 'ok') return null;
      const out = {};
      let bad = false;
      fields.forEach((f) => {
        const v = M.parseLength($(`#f_${f.key}`).value, units());
        if (!Number.isFinite(v) || v < 0 || (f.positive && v <= 0)) bad = true;
        out[f.key] = v;
        f.value = Number.isFinite(v) ? v : f.value;
      });
      if (!bad) return out;
      toast('Please enter valid sizes.');
    }
  }

  async function confirmDialog(title, text, okLabel = 'OK', danger = false) {
    const res = await dialog(title, `<p>${esc(text)}</p>`, [
      { label: 'Cancel', value: 'cancel', cls: 'ghost' },
      { label: okLabel, value: 'ok', cls: danger ? 'danger' : 'primary' },
    ]);
    return res === 'ok';
  }

  // ---------------------------------------------------------------------
  // Pieces and shapes

  function pieceCenter() {
    const b = Lay.pieceBBox(curLay());
    return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
  }

  async function addPiece(kind) {
    if (kind === 'draw') {
      project.pieces.push(M.newPiece(`Piece ${project.pieces.length + 1}`, M.newContour()));
      selectPiece(project.pieces.length - 1, false);
      startDraw('outline');
      return;
    }
    let outline;
    if (kind === 'circle') {
      const v = await askLengths('New circle piece', [{ key: 'd', label: 'Diameter', value: inch() ? 76.2 : 80, positive: true }], 'Add piece');
      if (!v) return;
      outline = M.circle(v.d / 2, v.d / 2, v.d / 2, 'holes');
    } else {
      const v = await askLengths('New rectangle piece', [
        { key: 'w', label: 'Width', value: inch() ? 101.6 : 100, positive: true },
        { key: 'h', label: 'Height', value: inch() ? 63.5 : 60, positive: true },
      ], 'Add piece');
      if (!v) return;
      outline = M.rectangle(v.w, v.h, 0, 0, 0, 'holes');
    }
    project.pieces.push(M.newPiece(`Piece ${project.pieces.length + 1}`, outline));
    selectPiece(project.pieces.length - 1);
  }

  async function addShape(kind) {
    if (!piece().outline.segments.length) {
      toast('Draw or add the piece outline first.');
      return;
    }
    const c = pieceCenter();
    let shape;
    if (kind === 'circle') {
      const v = await askLengths('Add a circle', [{ key: 'd', label: 'Diameter', value: inch() ? 19.05 : 20, positive: true }], 'Add');
      if (!v) return;
      shape = M.circle(v.d / 2, c.x, c.y, 'none');
    } else {
      const v = await askLengths('Add a rectangle', [
        { key: 'w', label: 'Width', value: inch() ? 25.4 : 25, positive: true },
        { key: 'h', label: 'Height', value: inch() ? 12.7 : 12, positive: true },
      ], 'Add');
      if (!v) return;
      shape = M.rectangle(v.w, v.h, 0, c.x - v.w / 2, c.y - v.h / 2, 'none');
    }
    const sh = M.newShape(shape);
    piece().cutouts.push(sh);
    ui.tool = 'select';
    ui.sel = { type: 'shape', items: [sh.id] };
    commit();
  }

  function selectPiece(i, doCommit = true) {
    ui.pieceIdx = Math.max(0, Math.min(project.pieces.length - 1, i));
    ui.sel = { type: null, items: [] };
    ui.combine = null;
    ui.highlight = null;
    if (ui.tool === 'draw') ui.tool = 'select';
    ui.view = null;
    if (doCommit) commit();
  }

  function clearSel() {
    ui.sel = { type: null, items: [] };
    ui.highlight = null;
  }

  function deleteSelected() {
    const pc = piece();
    if (ui.sel.type === 'shape') {
      pc.cutouts = pc.cutouts.filter((c) => !ui.sel.items.includes(c.id));
      toast('Shape deleted. Undo brings it back.');
    } else if (ui.sel.type === 'notch') {
      pc.notches = pc.notches.filter((n) => !ui.sel.items.includes(n.id));
      toast('Notch deleted. Undo brings it back.');
    } else return;
    clearSel();
    commit();
  }

  // ---------------------------------------------------------------------
  // Drawing. Draw makes the outline when the piece has none, otherwise a
  // new shape.

  function startDraw(target) {
    const pc = piece();
    let c;
    if (target === 'outline' || !pc.outline.segments.length) {
      ui.drawTarget = 'outline';
      c = pc.outline;
      pc.notches = []; // they belong to the old outline's edges
    } else if (target && target !== 'new') {
      ui.drawTarget = target;
      c = shapeById(target);
    } else {
      const sh = M.newShape(M.newContour());
      pc.cutouts.push(sh);
      ui.drawTarget = sh.id;
      c = sh;
    }
    const isOut = ui.drawTarget === 'outline';
    c.start = null;
    c.segments = [];
    c.closing = { mode: isOut ? 'holes' : 'none', fillet: 0, corner: true };
    ui.sel = { type: null, items: [] };
    ui.tool = 'draw';
    commit();
  }

  function finishDraw() {
    const c = drawContour();
    const isOut = ui.drawTarget === 'outline';
    ui.tool = 'select';
    if (c.segments.length < 2) {
      if (!isOut) {
        piece().cutouts = piece().cutouts.filter((x) => x !== c);
        clearSel();
      }
      toast('A shape needs at least two lines.');
    } else if (!isOut) {
      ui.sel = { type: 'shape', items: [c.id] };
    }
    ui.drawTarget = 'outline';
    commit();
  }

  function snapPoint(pt) {
    const c = drawContour();
    const s = ui.view.scale;
    if (ui.tool === 'draw' && c.start && c.segments.length >= 2 && G.dist(pt, c.start) * s < 12) {
      return { ...c.start, closes: true };
    }
    if (ui.tool === 'draw' && c.start && ui.shift) {
      const end = G.endPoint(c);
      const d = G.sub(pt, end);
      const a = Math.round(Math.atan2(d.y, d.x) / G.rad(15)) * G.rad(15);
      let L = G.len(d);
      if (ui.snap) L = Math.round(L / minorStep()) * minorStep();
      return { x: end.x + L * Math.cos(a), y: end.y + L * Math.sin(a) };
    }
    if (ui.snap) {
      const st = minorStep();
      return { x: Math.round(pt.x / st) * st, y: Math.round(pt.y / st) * st };
    }
    return pt;
  }

  function addDrawPoint(world) {
    const c = drawContour();
    const pt = snapPoint(world);
    if (!c.start) {
      c.start = { x: pt.x, y: pt.y };
      commit();
      return;
    }
    if (pt.closes) {
      finishDraw();
      return;
    }
    const end = G.endPoint(c);
    const d = G.sub(pt, end);
    const L = G.len(d);
    if (L < 1e-6) return;
    const mode = ui.drawTarget === 'outline' ? 'holes' : 'none';
    c.segments.push(M.seg('line', { length: round(L), angle: round(((G.deg(Math.atan2(d.y, d.x)) % 360) + 360) % 360), mode }));
    commit();
  }

  // ---------------------------------------------------------------------
  // Selection-driven edits

  const selected = (type) => (ui.sel.type === type ? ui.sel.items : []);

  function setModes(refs, mode) {
    refs.forEach((r) => {
      const t = edgeTarget(r);
      if (t) t.mode = mode;
    });
  }

  function setFillets(vrefs, r) {
    vrefs.forEach((v) => {
      const t = cornerTarget(v);
      if (t) t.fillet = r;
    });
  }

  // Refs of every edge whose mode can be set on a contour.
  function contourEdgeRefs(lc) {
    const seen = new Set();
    lc.contour.segments.forEach((s) => {
      if (s.ref && !s.ref.startsWith('n:')) seen.add(s.ref);
    });
    return [...seen];
  }

  // Outline edges, notches included through the edge they sit on.
  function outlineEdgeRefs() {
    return G.buildEdges(piece().outline).map((e) => `o:${e.edge}`);
  }
  function shapeEdgeRefs(sh) {
    return G.buildEdges(sh).map((e) => `c:${sh.id}:${e.edge}`);
  }

  // ---------------------------------------------------------------------
  // Canvas

  const svg = $('#canvas');

  function fitView() {
    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 600;
    let b = Lay.pieceBBox(curLay());
    if (!b || b.maxX - b.minX < 1e-6) b = { minX: -20, minY: -20, maxX: 180, maxY: 130 };
    const bw = Math.max(b.maxX - b.minX, 20);
    const bh = Math.max(b.maxY - b.minY, 20);
    // Leave room for the floating tool rail and legend.
    const scale = Math.min((w - 140) / bw, (h - 140) / bh);
    ui.view = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale: Math.max(0.05, scale) };
  }

  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    const s = ui.view.scale;
    return {
      x: ui.view.cx + (e.clientX - r.left - r.width / 2) / s,
      y: ui.view.cy - (e.clientY - r.top - r.height / 2) / s,
    };
  }

  function gridSvg(x0, y0, w, h, s) {
    const out = [];
    const minor = inch() ? 25.4 / 8 : 1;
    let major = inch() ? 25.4 : 10;
    while (major * s < 30) major *= inch() ? 2 : 5;
    const lines = (step, color) => {
      const parts = [];
      for (let x = Math.ceil(x0 / step) * step; x <= x0 + w; x += step) parts.push(`M${num(x)} ${num(y0)}V${num(y0 + h)}`);
      for (let y = Math.ceil(y0 / step) * step; y <= y0 + h; y += step) parts.push(`M${num(x0)} ${num(y)}H${num(x0 + w)}`);
      out.push(`<path d="${parts.join('')}" stroke="var(--${color})" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
    };
    if (minor * s >= 7) lines(minor, 'grid-minor');
    lines(major, 'grid-major');
    return out.join('');
  }


  function sectionPath(sec) {
    // Points along an adjusted spacing section, for highlighting.
    const L = G.pathLength(sec.path);
    const pts = [];
    const steps = 48;
    for (let k = 0; k <= steps; k++) {
      let s = sec.from + ((sec.to - sec.from) * k) / steps;
      if (sec.closed) s = ((s % L) + L) % L;
      pts.push(G.pathPointAt(sec.path, s));
    }
    return pts.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)} ${num(-p.y)}`).join('');
  }

  function renderCanvas() {
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    if (!w || !h) return;
    if (!ui.view) fitView();
    const s = ui.view.scale;
    const x0 = ui.view.cx - w / 2 / s;
    const y0 = -ui.view.cy - h / 2 / s;
    svg.setAttribute('viewBox', `${x0} ${y0} ${w / s} ${h / s}`);
    svg.setAttribute('class', `tool-${ui.tool}`);
    const px = (n) => n / s;
    const out = [gridSvg(x0, y0, w / s, h / s, s)];
    const pc = piece();
    const lay = curLay();
    const combining = ui.combine;
    const drawing = ui.tool === 'draw';
    const contours = [{ lc: lay.outline, kind: 'outline' }, ...lay.cutouts.map((lc) => ({ lc, kind: 'cutout' }))];
    const selEdges = new Set(selected('edge'));
    const selNotch = new Set(selected('notch'));
    const selShape = new Set(selected('shape'));
    const radii = radiiInUse(lay);
    const refOf = (lc, p) => {
      const sg = p.edge !== undefined ? edgeProps(lc.contour, p.edge) : null;
      return sg && sg.ref;
    };

    // Piece fill
    if (lay.outline.prims.length && !combining) {
      out.push(`<path d="${R.pathData(lay.outline.prims, flip, true)}" fill="color-mix(in srgb, var(--accent) 5%, transparent)" stroke="none"/>`);
    }

    // Shapes combined with the outline: a dashed outline you can grab.
    if (!combining) {
      pc.cutouts.filter(isLiveOp).forEach((sh) => {
        const prims = G.buildPrimitives(sh);
        if (!prims.length) return;
        const on = selShape.has(sh.id);
        const d = R.pathData(prims, flip, true);
        if (!drawing) out.push(`<path class="grab" d="${d}" fill="transparent" stroke="none" data-shape="${sh.id}"/>`);
        out.push(`<path d="${d}" fill="${on ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'none'}" stroke="var(--${on ? 'accent' : 'muted'})" stroke-width="${on ? 1.5 : 1}" stroke-dasharray="3 3" opacity="${on ? 1 : 0.7}" pointer-events="none" vector-effect="non-scaling-stroke"/>`);
      });
    }

    contours.forEach(({ lc, kind }) => {
      if (combining && kind === 'outline') return;
      const own = kind === 'cutout' && lc.src ? lc.src : null;
      if (kind === 'cutout' && !combining) {
        const on = own && selShape.has(own);
        out.push(`<path class="${own && !drawing ? 'grab' : ''}" d="${R.pathData(lc.prims, flip, true)}" fill="${on ? 'color-mix(in srgb, var(--accent) 14%, var(--canvas))' : 'var(--canvas)'}" stroke="none" ${own ? `data-shape="${own}"` : ''}/>`);
      }
      // Selection glow under selected edges and notches
      lc.prims.forEach((p) => {
        const ref = refOf(lc, p);
        const on = ref && (selEdges.has(ref) || (ref.startsWith('n:') && selNotch.has(ref.slice(2))));
        if (on) out.push(`<path d="${R.pathData([p], flip, false)}" fill="none" stroke="color-mix(in srgb, var(--accent) 35%, transparent)" stroke-width="10" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
      });
      if (own && selShape.has(own)) {
        out.push(`<path d="${R.pathData(lc.prims, flip, true)}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-opacity="0.3" vector-effect="non-scaling-stroke"/>`);
      }
      lc.prims.forEach((p) => {
        out.push(`<path d="${R.pathData([p], flip, false)}" fill="none" stroke="var(--edge-${p.mode === 'holes' ? 'none' : p.mode})" stroke-width="${kind === 'outline' ? 2 : 1.6}" vector-effect="non-scaling-stroke"/>`);
      });
      lc.stitch.forEach((st) => {
        out.push(`<path d="${R.pathData(st.prims, flip, st.closed)}" fill="none" stroke="var(--edge-stitch)" stroke-width="1.4" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>`);
      });
      lc.holes.forEach((hp) => {
        out.push(`<circle cx="${num(hp.x)}" cy="${num(-hp.y)}" r="${num(lay.holeRadius)}" fill="color-mix(in srgb, var(--edge-holes) 16%, var(--canvas))" stroke="var(--edge-holes)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      });
      if (!combining && ui.tool === 'select') {
        lc.prims.forEach((p) => {
          const ref = refOf(lc, p);
          if (p.fillet !== undefined || !ref) return;
          out.push(`<path class="hit" d="${R.pathData([p], flip, false)}" fill="none" stroke="transparent" stroke-width="14" stroke-linecap="round" vector-effect="non-scaling-stroke" data-ref="${esc(ref)}"/>`);
        });
      }
    });

    // Highlighted spacing section
    if (ui.highlight && ui.adjusted[ui.highlight - 1]) {
      out.push(`<path d="${sectionPath(ui.adjusted[ui.highlight - 1])}" fill="none" stroke="var(--zero)" stroke-width="6" stroke-opacity="0.45" stroke-linecap="round" pointer-events="none" vector-effect="non-scaling-stroke"/>`);
    }

    // Corner dots
    if (!combining && (ui.tool === 'select' || ui.tool === 'round')) {
      const selC = new Set(selected('corner'));
      const big = ui.tool === 'round';
      contours.forEach(({ lc }) => {
        cornersOf(lc).forEach((cn) => {
          const sel = selC.has(cn.vref);
          const r = big ? 6 : sel ? 6 : 4.5;
          const col = cn.fillet > 0 ? radiusColor(cn.fillet, radii) : null;
          const fill = sel ? 'var(--accent)' : col || 'var(--panel)';
          const tip = `${cn.fillet ? `Rounded ${fmt(cn.fillet)} ${units()}` : 'Sharp corner'}${cn.corner ? '' : ', no corner hole'}`;
          out.push(`<circle class="vtx" cx="${num(cn.pt.x)}" cy="${num(-cn.pt.y)}" r="${num(px(r))}" fill="${fill}" stroke="${col && !sel ? 'var(--panel)' : 'var(--accent)'}" stroke-width="${sel ? 2 : 1.5}" ${cn.corner ? '' : 'stroke-dasharray="2 2"'} vector-effect="non-scaling-stroke" data-vref="${esc(cn.vref)}"><title>${tip}</title></circle>`);
        });
      });
    }

    // Choosing lines
    if (combining) {
      combining.pieces.forEach((pcs, i) => {
        const d = R.pathData([pcs.prim], flip, false);
        out.push(pcs.keep
          ? `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke"/>`
          : `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="1.25" stroke-dasharray="4 4" opacity="0.7" vector-effect="non-scaling-stroke"/>`);
        out.push(`<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke" data-piece="${i}"><title>Click to ${pcs.keep ? 'remove' : 'keep'} this line</title></path>`);
      });
    }

    // Origin points
    contours.forEach(({ lc }) => {
      const o = lc.origin;
      if (!o) return;
      const z = o.pt;
      const r = px(7);
      const tick = o.kind === 'stitch' ? Lay.originTick(o, Math.max(px(9), 3)) : null;
      out.push(`<g stroke="var(--zero)" stroke-width="2" fill="none" pointer-events="none">
        <circle cx="${num(z.x)}" cy="${num(-z.y)}" r="${num(o.kind === 'hole' ? Math.max(r, lay.holeRadius + px(4)) : r)}" vector-effect="non-scaling-stroke"/>
        ${tick ? `<path d="M${num(tick.a.x)} ${num(-tick.a.y)}L${num(tick.b.x)} ${num(-tick.b.y)}" stroke-width="3" vector-effect="non-scaling-stroke"/>` : `<path d="M${num(z.x - r * 1.7)} ${num(-z.y)}H${num(z.x + r * 1.7)}M${num(z.x)} ${num(-z.y - r * 1.7)}V${num(-z.y + r * 1.7)}" vector-effect="non-scaling-stroke"/>`}</g>`);
    });

    // Drawing preview
    if (drawing) {
      const c = drawContour();
      if (c.start) {
        let end = c.start;
        G.buildEdges(c).filter((e) => !e.closing).forEach((e) => {
          out.push(`<path d="${R.pathData([e], flip, false)}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
          end = G.primEnd(e);
        });
        out.push(`<circle cx="${num(c.start.x)}" cy="${num(-c.start.y)}" r="${num(px(7))}" fill="var(--panel)" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
        if (ui.mouse) {
          const m = snapPoint(ui.mouse);
          out.push(`<path d="M${num(end.x)} ${num(-end.y)}L${num(m.x)} ${num(-m.y)}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`);
          const d = G.sub(m, end);
          const lbl = `${fmt(G.len(d))} ${units()} · ${num(Math.round(((G.deg(Math.atan2(d.y, d.x)) % 360) + 360) % 360 * 10) / 10)}°`;
          out.push(`<g transform="translate(${num(m.x + px(12))} ${num(-m.y - px(12))})"><rect x="0" y="${num(-px(15))}" width="${num(px(lbl.length * 6.6 + 12))}" height="${num(px(20))}" rx="${num(px(5))}" fill="var(--ink)"/><text x="${num(px(6))}" y="${num(-px(1))}" font-size="${num(px(12))}" fill="var(--bg)">${esc(lbl)}</text></g>`);
        }
      } else if (ui.mouse) {
        const m = snapPoint(ui.mouse);
        out.push(`<circle cx="${num(m.x)}" cy="${num(-m.y)}" r="${num(px(4))}" fill="var(--accent)"/>`);
      }
    }
    svg.innerHTML = out.join('');
    renderHint();
    renderZoom();
  }

  function renderHint() {
    const c = drawContour();
    let msg = '';
    if (ui.tool === 'draw') {
      msg = !c.start
        ? 'Click to place the first point.'
        : 'Click to add points · Shift for 15° steps · click the first point or press Enter to finish · Backspace removes the last line';
    } else if (ui.combine) {
      msg = 'Click lines to keep (solid) or remove (dashed), then Apply.';
    } else if (ui.tool === 'origin') {
      msg = 'Click a hole or a stitch line to make it the origin point · Esc to cancel';
    } else if (ui.tool === 'round') {
      msg = `Click corners to round them ${fmt(ui.brush || 0)} ${units()} · click again to make sharp · Esc when done`;
    } else if (ui.sel.type === 'edge' || ui.sel.type === 'corner') {
      msg = 'Shift-click to select more · Esc to deselect';
    } else if (ui.sel.type === 'shape') {
      msg = 'Drag to move · Delete to remove';
    } else if (ui.sel.type === 'notch') {
      msg = 'Change the notch on the right · Delete to remove';
    } else {
      msg = 'Click an edge, corner or shape to change it · drag to pan, scroll to zoom';
    }
    $('#hint').textContent = msg;
  }

  function renderZoom() {
    const pct = $('#zoomPct');
    // 100% = true size on a 96 dpi screen.
    if (pct && ui.view) pct.textContent = `${Math.round((ui.view.scale / (96 / 25.4)) * 100)}%`;
  }

  // Origin tool: snap to the nearest hole, or else onto a stitch line.
  function placeOrigin(world) {
    const lay = curLay();
    const pc = piece();
    const tol = 14 / ui.view.scale;
    let best = null;
    const contours = [{ lc: lay.outline, src: 'outline' }, ...lay.cutouts.map((lc) => ({ lc, src: lc.src }))];
    contours.forEach(({ lc, src }) => {
      lc.holes.forEach((hp) => {
        const d = G.dist(hp, world);
        if (d <= Math.max(tol, lay.holeRadius) && (!best || d < best.d)) best = { d, pt: hp, src };
      });
    });
    if (!best) {
      contours.forEach(({ lc, src }) => {
        lc.stitch.forEach((st) => {
          const n = G.nearestOnPath(st.prims, world);
          if (n && n.d <= tol && (!best || n.d < best.d)) best = { d: n.d, pt: n.pt, src };
        });
      });
    }
    if (!best) {
      toast('Click a hole or a stitch line.');
      return;
    }
    if (!best.src) {
      toast('That cutout comes from combining shapes, so it can’t have its own origin.');
      return;
    }
    const target = best.src === 'outline' ? pc.outline : shapeById(best.src);
    target.origin = { x: round(best.pt.x), y: round(best.pt.y) };
    ui.tool = 'select';
    commit();
  }

  // Round tool: give the corner the brush radius, or make it sharp again.
  function brushCorner(vref) {
    const t = cornerTarget(vref);
    if (!t) return;
    const r = ui.brush || 0;
    t.fillet = Math.abs((Number(t.fillet) || 0) - r) < 1e-6 ? 0 : r;
    commit();
  }

  function handleCanvasClick(target, world, shiftKey) {
    if (ui.tool === 'draw') {
      addDrawPoint(world);
      return;
    }
    if (ui.combine) {
      const pe = target && target.closest ? target.closest('[data-piece]') : null;
      if (pe) {
        const pcs = ui.combine.pieces[Number(pe.dataset.piece)];
        pcs.keep = !pcs.keep;
        renderCanvas();
        renderRight();
      }
      return;
    }
    if (ui.tool === 'origin') {
      placeOrigin(world);
      return;
    }
    const el = target && target.closest ? target.closest('[data-ref],[data-vref],[data-shape]') : null;
    if (ui.tool === 'round') {
      if (el && el.dataset.vref) brushCorner(el.dataset.vref);
      else toast('Click a corner dot to round it.');
      return;
    }
    if (!el) {
      clearSel();
      renderAll();
      return;
    }
    if (el.dataset.shape) {
      ui.sel = { type: 'shape', items: [el.dataset.shape] };
      renderAll();
      return;
    }
    if (el.dataset.ref && el.dataset.ref.startsWith('n:')) {
      ui.sel = { type: 'notch', items: [parseRef(el.dataset.ref).id] };
      renderAll();
      return;
    }
    const type = el.dataset.vref ? 'corner' : 'edge';
    const ref = type === 'corner' ? el.dataset.vref : el.dataset.ref;
    if (shiftKey && ui.sel.type === type) {
      const items = new Set(ui.sel.items);
      if (items.has(ref)) items.delete(ref);
      else items.add(ref);
      ui.sel = items.size ? { type, items: [...items] } : { type: null, items: [] };
    } else {
      ui.sel = { type, items: [ref] };
    }
    renderAll();
  }

  svg.addEventListener('pointerdown', (e) => {
    ui.ptr = { x: e.clientX, y: e.clientY, cx: ui.view.cx, cy: ui.view.cy, moved: false, target: e.target, button: e.button, shift: e.shiftKey };
    const grab = e.button === 0 && ui.tool === 'select' && !ui.combine && e.target.closest
      ? e.target.closest('[data-shape]')
      : null;
    if (grab) {
      const sh = shapeById(grab.dataset.shape);
      if (sh && sh.start) ui.ptr.drag = { id: sh.id, start: { ...sh.start }, origin: sh.origin ? { ...sh.origin } : null };
    }
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    ui.mouse = toWorld(e);
    ui.shift = e.shiftKey;
    if (ui.ptr) {
      const dx = e.clientX - ui.ptr.x;
      const dy = e.clientY - ui.ptr.y;
      if (Math.hypot(dx, dy) > 4) ui.ptr.moved = true;
      if (ui.ptr.moved && ui.ptr.drag) {
        const d = ui.ptr.drag;
        const sh = shapeById(d.id);
        let mx = dx / ui.view.scale;
        let my = -dy / ui.view.scale;
        if (ui.snap) {
          const st = minorStep();
          mx = Math.round(mx / st) * st;
          my = Math.round(my / st) * st;
        }
        if (sh) {
          sh.start = { x: round(d.start.x + mx), y: round(d.start.y + my) };
          if (d.origin) sh.origin = { x: d.origin.x + mx, y: d.origin.y + my };
          ui.sel = { type: 'shape', items: [sh.id] };
        }
      } else if (ui.ptr.moved) {
        ui.view.cx = ui.ptr.cx - dx / ui.view.scale;
        ui.view.cy = ui.ptr.cy + dy / ui.view.scale;
      }
      if (ui.ptr.moved) renderCanvas();
    } else if (ui.tool === 'draw') {
      renderCanvas();
    }
  });
  svg.addEventListener('pointerup', (e) => {
    const p = ui.ptr;
    ui.ptr = null;
    if (p && p.drag && p.moved) {
      commit();
      return;
    }
    if (p && !p.moved && p.button === 0) handleCanvasClick(p.target, toWorld(e), p.shift);
  });
  svg.addEventListener('pointerleave', () => {
    if (!ui.ptr && ui.tool === 'draw') {
      ui.mouse = null;
      renderCanvas();
    }
  });
  function zoomBy(k, at) {
    const r = svg.getBoundingClientRect();
    const ev = at || { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const before = toWorld(ev);
    ui.view.scale = Math.max(0.05, Math.min(200, ui.view.scale * k));
    const after = toWorld(ev);
    ui.view.cx += before.x - after.x;
    ui.view.cy += before.y - after.y;
    renderCanvas();
  }
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e);
    },
    { passive: false }
  );


  // ---------------------------------------------------------------------
  // Tool rail and zoom

  function setTool(tool) {
    if (ui.combine) ui.combine = null;
    if (ui.tool === 'draw' && tool !== 'draw') finishDraw();
    if (tool === 'draw') {
      if (ui.tool !== 'draw') startDraw();
      return;
    }
    if (tool === 'round' && !(ui.brush > 0)) ui.brush = inch() ? 25.4 / 8 : 3;
    ui.tool = ui.tool === tool && tool !== 'select' ? 'select' : tool;
    if (ui.tool !== 'select') clearSel();
    renderAll();
  }

  function renderRail() {
    const btn = (attrs, ic, tip, on) => `<button class="icon-btn ${on ? 'on' : ''}" ${attrs} data-tip="${tip}" aria-label="${tip}">${icon(ic)}</button>`;
    $('#rail').innerHTML = [
      btn('data-tool="select"', 'select', 'Select (V)', ui.tool === 'select' && !ui.combine),
      btn('data-tool="draw"', 'pen', piece().outline.segments.length ? 'Draw a shape (P)' : 'Draw the outline (P)', ui.tool === 'draw'),
      '<hr>',
      btn('data-add="rect"', 'rect', 'Add a rectangle', false),
      btn('data-add="circle"', 'circle', 'Add a circle', false),
      '<hr>',
      btn('data-tool="round"', 'corner', 'Round corners (R)', ui.tool === 'round'),
      btn('data-tool="origin"', 'target', 'Place origin point (O)', ui.tool === 'origin'),
      btn('data-snap="1"', 'magnet', ui.snap ? 'Snap to grid: on' : 'Snap to grid: off', ui.snap),
    ].join('');
    $('#zoom').innerHTML = `
      <button class="icon-btn" data-zoom="out" aria-label="Zoom out">${icon('minus')}</button>
      <span class="pct" id="zoomPct"></span>
      <button class="icon-btn" data-zoom="in" aria-label="Zoom in">${icon('plus')}</button>
      <button class="icon-btn" data-zoom="fit" title="Fit to screen" aria-label="Fit to screen">${icon('fit')}</button>`;
  }

  $('#rail').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.add) {
      if (ui.tool === 'draw') finishDraw();
      addShape(b.dataset.add);
    } else if (b.dataset.snap) {
      ui.snap = !ui.snap;
      renderRail();
    }
  });

  $('#zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.zoom === 'fit') {
      fitView();
      renderCanvas();
    } else zoomBy(b.dataset.zoom === 'in' ? 1.25 : 0.8);
  });

  // ---------------------------------------------------------------------
  // Left sidebar: pieces, and one Stitching section for the whole project
  // (sizes, hole count and spacing check, origin points).

  function thumb(pc) {
    let lay;
    try {
      lay = Lay.layoutPiece(project, pc);
    } catch (e) {
      return '';
    }
    const prims = lay.outline.prims;
    const b = G.bbox(prims);
    if (!b) return '';
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxY - b.minY, 1);
    const pad = Math.max(w, h) * 0.08;
    const holes = lay.cutouts.map((c) => R.pathData(c.prims, flip, true)).join('');
    return `<svg viewBox="${num(b.minX - pad)} ${num(-b.maxY - pad)} ${num(w + 2 * pad)} ${num(h + 2 * pad)}" preserveAspectRatio="xMidYMid meet"><path d="${R.pathData(prims, flip, true)}${holes}" fill-rule="evenodd" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function sizeText(c) {
    const b = RS.rawBox(c);
    if (!b) return 'Empty';
    if (RS.isCircle(c)) return `${fmt(b.maxX - b.minX)} ${units()} circle`;
    return `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} ${units()}`;
  }

  function settingsFields(obj) {
    return [
      ['holeDiameter', 'Hole size', 'Diameter of your round punch'],
      ['spacing', 'Spacing', 'Centre to centre of neighbouring holes'],
      ['edgeDistance', 'From edge', 'Gap between the hole and the leather edge'],
      ['stitchOffset', 'Stitch line', 'Distance of the stitch line from the edge'],
    ]
      .map(([k, label, tip]) => `<label class="fld" title="${tip}"><span>${label}</span>${numInput(`data-set="d_" data-key="${k}"`, obj[k])}</label>`)
      .join('');
  }

  function originLabel(o) {
    if (!o) return 'Not set';
    return o.kind === 'hole' ? 'On a hole' : 'On the stitch line';
  }

  function stitchSection() {
    const d = project.defaults;
    const lay = curLay();
    const pc = piece();
    const all = [lay.outline, ...lay.cutouts];
    const holes = all.reduce((n, c) => n + c.holes.length, 0);
    ui.adjusted = [];
    all.forEach((c) => c.sections.forEach((s) => {
      if (s.actual && Math.abs(s.actual - s.requested) > 0.005) ui.adjusted.push(s);
    }));
    const adj = ui.adjusted;
    const origins = [];
    if (pc.outline.segments.length) origins.push({ label: 'Outline', key: 'outline', set: !!pc.outline.origin, lay: lay.outline });
    lay.cutouts.forEach((lc) => {
      if (!lc.src) return;
      const sh = shapeById(lc.src);
      if (sh && sh.origin) origins.push({ label: `Shape ${shapeNo(sh.id)}`, key: sh.id, set: true, lay: lc });
    });
    const anyOrigin = origins.some((o) => o.set);
    const summary = [`${fmt(d.holeDiameter)} ${units()} holes`, `${fmt(d.spacing)} ${units()} apart`, holes ? `${holes} holes` : null, anyOrigin ? 'origin set' : null]
      .filter(Boolean)
      .join(' · ');
    const check = !holes
      ? '<p class="note">No edges have holes yet. Click an edge and choose Holes.</p>'
      : adj.length
        ? `<details class="check" id="checkDetails" ${ui.checkOpen ? 'open' : ''}>
            <summary>${holes} holes · ${adj.length} run${adj.length === 1 ? '' : 's'} adjusted slightly</summary>
            <p class="note">Spacing on these runs is stretched or squeezed a little so a hole lands on each corner. Click one to see it.</p>
            ${adj.map((s, i) => `<button class="run ${ui.highlight === i + 1 ? 'on' : ''}" data-run="${i + 1}">${fmt(s.length)} ${units()} run · ${fmt(s.actual)} apart</button>`).join('')}
          </details>`
        : `<div class="ok">${icon('check')} ${holes} holes, all at exactly ${fmt(d.spacing)} ${units()}</div>`;
    const originRows = origins
      .map((o) => `<div class="origin-row"><span><b>${esc(o.label)}</b> <span class="muted">${o.set ? originLabel(o.lay.origin) : 'Not set'}</span></span>
          ${o.set ? `<button class="icon-btn" data-clear-origin="${esc(o.key)}" title="Remove" aria-label="Remove origin">${icon('x')}</button>` : ''}</div>`)
      .join('');
    return `<details class="stitch-panel" id="stitchPanel" ${ui.stitchOpen ? 'open' : ''}>
      <summary><span class="t">Stitching</span><span class="sum">${esc(summary)}</span></summary>
      <div class="body">
        <div class="grid2">${settingsFields(d)}</div>
        <div class="sub-h">Hole count</div>
        ${check}
        <div class="sub-h">Origin point</div>
        ${originRows}
        <button class="small ${ui.tool === 'origin' ? 'primary' : ''}" data-tool-start="origin">${icon('target')} ${ui.tool === 'origin' ? 'Click a hole or stitch line…' : 'Place origin point'}</button>
        <p class="note">A hole always lands on the origin, or a tick marks it on a stitch line, so pieces that share one line up.</p>
      </div></details>`;
  }

  function renderLeft() {
    const pieces = project.pieces
      .map((p, i) => `<div class="piece-card ${i === ui.pieceIdx ? 'on' : ''}" data-piece="${i}">
          <div class="thumb">${thumb(p)}</div>
          <div class="meta"><div class="name">${esc(p.name)}</div><div class="size">${sizeText(p.outline)}</div></div>
          <div class="acts">
            <button class="icon-btn" data-dup="${i}" title="Duplicate" aria-label="Duplicate">${icon('copy')}</button>
            <button class="icon-btn" data-del="${i}" title="Delete" aria-label="Delete" ${project.pieces.length < 2 ? 'disabled' : ''}>${icon('trash')}</button>
          </div></div>`)
      .join('');
    $('#leftPanel').innerHTML = `
      <div class="section-title">Pieces
        <div class="menu-wrap">
          <button class="small" id="btnAddPiece" aria-haspopup="menu">${icon('plus')} New</button>
          <div class="menu" id="pieceMenu" role="menu" hidden>
            <button data-newpiece="rect" role="menuitem">${icon('rect')} Rectangle</button>
            <button data-newpiece="circle" role="menuitem">${icon('circle')} Circle</button>
            <button data-newpiece="draw" role="menuitem">${icon('pen')} Draw your own</button>
          </div>
        </div>
      </div>
      <div class="pieces">${pieces}</div>
      ${stitchSection()}`;
    const sp = $('#stitchPanel');
    sp.addEventListener('toggle', () => {
      ui.stitchOpen = sp.open;
      setPref('stitchOpen', sp.open);
    });
    const cd = $('#checkDetails');
    if (cd) cd.addEventListener('toggle', () => (ui.checkOpen = cd.open));
  }

  $('#leftPanel').addEventListener('click', async (e) => {
    const t = e.target.closest('button,[data-piece]');
    if (!t) return;
    if (t.id === 'btnAddPiece') {
      toggleMenu('#pieceMenu');
      return;
    }
    if (t.dataset.newpiece) {
      closeMenus();
      addPiece(t.dataset.newpiece);
      return;
    }
    if (t.dataset.dup !== undefined) {
      const i = Number(t.dataset.dup);
      const copy = JSON.parse(JSON.stringify(project.pieces[i]));
      copy.id = M.uid();
      copy.name = `${project.pieces[i].name} copy`;
      project.pieces.splice(i + 1, 0, copy);
      selectPiece(i + 1);
      return;
    }
    if (t.dataset.del !== undefined) {
      const i = Number(t.dataset.del);
      project.pieces.splice(i, 1);
      selectPiece(Math.min(i, project.pieces.length - 1));
      toast('Piece deleted. Undo brings it back.');
      return;
    }
    if (t.dataset.run) {
      const k = Number(t.dataset.run);
      ui.highlight = ui.highlight === k ? null : k;
      renderLeft();
      renderCanvas();
      return;
    }
    if (t.dataset.clearOrigin) {
      const k = t.dataset.clearOrigin;
      if (k === 'outline') delete piece().outline.origin;
      else {
        const sh = shapeById(k);
        if (sh) delete sh.origin;
      }
      commit();
      return;
    }
    if (t.dataset.toolStart) {
      setTool(t.dataset.toolStart);
      return;
    }
    if (t.dataset.piece !== undefined) selectPiece(Number(t.dataset.piece));
  });

  function parseInto(t, assign, positive = false) {
    const v = M.parseLength(t.value, units());
    if (!Number.isFinite(v) || v < 0 || (positive && v <= 0)) {
      t.classList.add('bad');
      toast('That size isn’t valid.');
      return;
    }
    assign(v);
    commit();
  }

  $('#leftPanel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.set === 'd_') parseInto(t, (v) => (project.defaults[t.dataset.key] = v));
  });

  // ---------------------------------------------------------------------
  // Right inspector

  function head(ic, title, sub, editable) {
    return `<div class="insp-head"><div class="badge">${icon(ic)}</div><div class="grow">${
      editable ? `<input type="text" id="pieceName" value="${esc(title)}" aria-label="Piece name">` : `<div class="title">${esc(title)}</div>`
    }<div class="sub">${sub}</div></div></div>`;
  }

  function modeSeg(current, attr = 'data-setmode') {
    return `<div class="seg wide">${['holes', 'stitch', 'none']
      .map((m) => `<button class="${current === m ? 'on' : ''}" ${attr}="${m}"><i class="sw ${m}"></i>${MODE_LABEL[m]}</button>`)
      .join('')}</div>`;
  }

  function commonValue(list) {
    return list.length && list.every((v) => Math.abs(v - list[0]) < 1e-9 || v === list[0]) ? list[0] : null;
  }

  const RADIUS_CHIPS = { mm: [2, 3, 5, 8, 10], in: [1 / 16, 1 / 8, 3 / 16, 1 / 4, 1 / 2] };
  const chipLabel = (v) => (inch() ? ({ 0.0625: '1/16', 0.125: '1/8', 0.1875: '3/16', 0.25: '1/4', 0.5: '1/2' })[v] || String(v) : String(v));

  // Slider, typed size and quick sizes. scope: 'brush' | 'sel' | 'notch'.
  function radiusControl(value, scope, withZero = false) {
    const max = inch() ? 50.8 : 50;
    const step = inch() ? 25.4 / 32 : 0.5;
    const list = (withZero ? [0] : []).concat(RADIUS_CHIPS[units()]);
    const chips = list
      .map((v) => {
        const mm = inch() ? v * 25.4 : v;
        const on = value !== null && Math.abs(value - mm) < 1e-6;
        return `<button class="${on ? 'on' : ''}" data-radius="${mm}" data-scope="${scope}">${chipLabel(v)}</button>`;
      })
      .join('');
    return `<div class="slider-row">
        <input type="range" min="0" max="${max}" step="${step}" value="${value === null ? 0 : Math.min(value, max)}" data-radius-slider="${scope}" aria-label="Corner radius">
        ${numInput(`data-radius-input="${scope}" placeholder="mixed"`, value === null ? '' : value)}
      </div>
      <div class="chips">${chips}<span class="muted" style="font-size:12px;align-self:center">${units()}</span></div>`;
  }

  // Legend of the radii in use, coloured like the corner dots.
  function radiusLegend() {
    const corners = allCorners();
    const radii = radiiInUse();
    if (!radii.length) return '<p class="note">No rounded corners yet.</p>';
    return `<div class="radius-legend">${radii
      .map((r) => {
        const n = corners.filter((c) => Math.abs(c.fillet - r) < 1e-6).length;
        return `<button data-radius="${r}" data-scope="brush" title="Use this size"><i style="background:${radiusColor(r, radii)}"></i>${fmt(r)} ${units()} <span class="muted">· ${n} corner${n === 1 ? '' : 's'}</span></button>`;
      })
      .join('')}</div>`;
  }

  // Width and height boxes (or diameter for a circle).
  function sizeCard(c, prefix) {
    const b = RS.rawBox(c);
    if (!b) return '';
    if (RS.isCircle(c)) {
      return `<div class="card"><h4>${icon('resize')} Size</h4><label class="fld"><span>Diameter</span>${numInput(`data-size="${prefix}" data-dim="d"`, b.maxX - b.minX)}</label></div>`;
    }
    return `<div class="card"><h4>${icon('resize')} Size</h4><div class="grid2">
        <label class="fld"><span>Width</span>${numInput(`data-size="${prefix}" data-dim="w"`, b.maxX - b.minX)}</label>
        <label class="fld"><span>Height</span>${numInput(`data-size="${prefix}" data-dim="h"`, b.maxY - b.minY)}</label></div>
      <p class="note">Edges stretch; rounded corners${prefix === 'piece' ? ', notches and shapes' : ''} keep their size.</p></div>`;
  }

  function advancedSection(c, selIdx) {
    const n = c.segments.length;
    const closing = G.closingEdge(c);
    const inp = (i, key, val, isLen = true) =>
      `<input type="text" inputmode="decimal" data-seg="${i}" data-key="${key}" value="${isLen ? fmt(val) : num(Number(val) || 0)}">`;
    const selE = new Set(selIdx || []);
    const rows = c.segments
      .map((s, i) => {
        const a = s.type === 'arc';
        return `<tr class="${selE.has(i) ? 'sel' : ''}"><td><span class="tag">${i + 1}</span></td>
          <td><select data-seg="${i}" data-key="type"><option value="line" ${a ? '' : 'selected'}>Line</option><option value="arc" ${a ? 'selected' : ''}>Arc</option></select></td>
          <td>${a ? inp(i, 'radius', s.radius) : inp(i, 'length', s.length)}</td>
          <td>${inp(i, 'angle', s.angle, false)}</td>
          <td>${a ? inp(i, 'sweep', s.sweep, false) : ''}</td>
          <td><button class="icon-btn" style="width:26px;height:26px" data-del-seg="${i}" title="Remove edge" aria-label="Remove edge">${icon('trash')}</button></td></tr>`;
      })
      .join('');
    const closeRow = closing
      ? `<tr class="${selE.has(n) ? 'sel' : ''}"><td><span class="tag">${n + 1}</span></td><td class="ro">Closing</td><td class="ro">${fmt(closing.length)}</td><td class="ro">${num(Math.round(closing.angle * 10) / 10)}</td><td></td><td></td></tr>`
      : '';
    return `<details class="adv" id="advDetails" ${ui.advOpen ? 'open' : ''}>
      <summary>Exact dimensions</summary>
      <div class="body">
        <div class="grid2" style="margin-bottom:10px">
          <label class="fld"><span>Start X</span>${numInput('id="startX"', c.start ? c.start.x : '')}</label>
          <label class="fld"><span>Start Y</span>${numInput('id="startY"', c.start ? c.start.y : '')}</label>
        </div>
        <table class="edit">
          <colgroup><col style="width:26px"><col style="width:64px"><col><col style="width:56px"><col style="width:52px"><col style="width:30px"></colgroup>
          <thead><tr><th>#</th><th>Type</th><th>Length / radius</th><th>Angle°</th><th>Sweep°</th><th></th></tr></thead>
          <tbody>${rows}${closeRow}</tbody>
        </table>
        <div class="row" style="margin-top:8px"><button class="small" id="addLine">${icon('plus')} Line</button><button class="small" id="addArc">${icon('plus')} Arc</button>
          <button class="small ghost" id="redraw">${icon('pen')} Redraw</button></div>
        <p class="note">Angle is the direction an edge starts in: 0° right, 90° up, 180° left, 270° down. An arc's sweep turns left when positive and right when negative.</p>
      </div></details>`;
  }

  // The contour that "Exact dimensions" edits right now.
  function advContour() {
    if (ui.sel.type === 'shape') return shapeById(ui.sel.items[0]);
    return piece().outline;
  }

  function renderPieceInspector() {
    const pc = piece();
    const c = pc.outline;
    const lay = curLay();
    if (!c.segments.length) {
      return `${head('piece', pc.name, 'No outline yet', true)}
        <div class="tip">${icon('info')}<div>Pick <b>Draw</b> in the tool bar and click points on the grid, or start from a shape.</div></div>
        <button class="primary block" data-tool-start="draw-outline">${icon('pen')} Draw the outline</button>`;
    }
    const refs = outlineEdgeRefs();
    const modes = refs.map((r) => (edgeTarget(r) || {}).mode || 'none');
    const corners = cornersOf(lay.outline);
    const allOn = corners.length && corners.every((x) => x.corner);
    return `${head('piece', pc.name, sizeText(c), true)}
      ${sizeCard(c, 'piece')}
      <div class="card"><h4>${icon('edge')} All edges</h4>${modeSeg(commonValue(modes), 'data-allmode')}
        <p class="note">Or click one edge on the drawing to set just that one.</p></div>
      <div class="card"><h4>${icon('corner')} Round corners</h4>
        ${radiusControl(ui.brush, 'brush')}
        <p class="note">Pick a size, then click the corner dots you want rounded. Click a corner again to make it sharp.</p>
        ${radiusLegend()}</div>
      ${corners.length > 1 ? `<div class="card"><label class="switch"><span>Hole on every corner</span><input type="checkbox" id="allCorners" ${allOn ? 'checked' : ''}></label>
        <p class="note">Spacing adjusts slightly so a hole lands exactly on each corner. Click a corner to turn just that one off.</p></div>` : ''}
      ${advancedSection(c)}`;
  }

  function renderRoundInspector() {
    return `${head('corner', 'Round corners', ui.brush > 0 ? `${fmt(ui.brush)} ${units()}` : 'Sharp')}
      <div class="tip">${icon('info')}<div>Click corner dots on the drawing to give them this radius. Click a corner again to make it sharp. Pick another size to keep going.</div></div>
      <div class="card"><h4>Radius</h4>${radiusControl(ui.brush, 'brush')}</div>
      <div class="card"><h4>In use</h4>${radiusLegend()}</div>
      <button class="primary" data-tool-start="select">${icon('check')} Done</button>`;
  }

  function edgeLabel(ref) {
    const r = parseRef(ref);
    return r.kind === 'o' || r.kind === 'c' ? `Edge ${r.idx + 1}` : 'Edge';
  }

  function renderEdgeInspector() {
    const items = selected('edge');
    const modes = items.map((r) => (edgeTarget(r) || {}).mode || 'none');
    const one = items.length === 1 ? items[0] : null;
    let detail = '';
    let notchBtn = '';
    if (one) {
      const r = parseRef(one);
      const c = r.kind === 'o' ? piece().outline : r.kind === 'c' ? shapeById(r.id) : null;
      const s = c && c.segments[r.idx];
      const e = c && G.buildEdges(c).find((x) => x.edge === r.idx);
      if (s) {
        detail = s.type === 'arc'
          ? `<div class="grid2"><label class="fld"><span>Radius</span>${numInput(`data-eseg="${esc(one)}" data-key="radius"`, s.radius)}</label>
             <label class="fld"><span>Sweep °</span><input type="text" inputmode="decimal" data-eseg="${esc(one)}" data-key="sweep" value="${num(Number(s.sweep))}"></label></div>`
          : `<div class="grid2"><label class="fld"><span>Length</span>${numInput(`data-eseg="${esc(one)}" data-key="length"`, s.length)}</label>
             <label class="fld"><span>Angle °</span><input type="text" inputmode="decimal" data-eseg="${esc(one)}" data-key="angle" value="${num(Number(s.angle))}"></label></div>`;
      } else if (e) {
        detail = `<p class="ok">Closing edge, ${fmt(G.primLength(e))} ${units()} long. It joins the last point back to the start.</p>`;
      }
      if (r.kind === 'o' && e && e.type === 'line') {
        notchBtn = `<div class="card"><h4>${icon('notch')} Notch</h4>
          <button class="small" id="addNotch">${icon('plus')} Add a notch to this edge</button>
          <p class="note">A thumb notch or scoop, centred on the edge. You can set its width, depth and position next.</p></div>`;
      }
    }
    const wheres = [...new Set(items.map(refWhere))];
    return `${head('edge', one ? edgeLabel(one) : `${items.length} edges`, `On ${wheres.join(', ')}`)}
      <div class="card"><h4>Along this edge</h4>${modeSeg(commonValue(modes))}</div>
      ${notchBtn}
      ${detail ? `<div class="card"><h4>Size</h4>${detail}</div>` : ''}
      <div class="row"><button class="small" data-selall="edge">Select all outline edges</button><button class="small ghost" data-deselect="1">Done</button></div>`;
  }

  function renderCornerInspector() {
    const items = selected('corner');
    const targets = items.map(cornerTarget).filter(Boolean);
    const fil = commonValue(targets.map((t) => Number(t.fillet) || 0));
    const corner = targets.map((t) => t.corner !== false);
    const all = corner.every(Boolean);
    const none = corner.every((x) => !x);
    const one = items.length === 1;
    const wheres = [...new Set(items.map(refWhere))];
    return `${head('corner', one ? 'Corner' : `${items.length} corners`, `On ${wheres.join(', ')}`)}
      <div class="card"><h4>Rounded</h4>${radiusControl(fil, 'sel', true)}</div>
      <div class="card"><label class="switch"><span>Hole on this corner</span><input type="checkbox" id="selCorner" ${all ? 'checked' : ''} ${!all && !none ? 'data-mixed="1"' : ''}></label>
        <p class="note">Rounded corners have no single point, so holes simply follow the curve.</p></div>
      <div class="row"><button class="small" data-selall="corner">Select all corners</button><button class="small ghost" data-deselect="1">Done</button></div>`;
  }

  // Which end of an edge it starts at, in words ("left", "top", ...).
  function edgeEnds(e) {
    const u = G.norm(G.sub(e.b, e.a));
    if (Math.abs(u.x) >= Math.abs(u.y)) return u.x > 0 ? ['left', 'right'] : ['right', 'left'];
    return u.y > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  function renderNotchInspector() {
    const n = notchById(selected('notch')[0]);
    const lay = curLay();
    const rep = (lay.resolved.report.notches || {})[n.id] || {};
    const e = G.buildEdges(piece().outline).find((x) => x.edge === n.edge);
    const ends = e && e.type === 'line' ? edgeEnds(e) : ['start', 'end'];
    const centred = n.at === null || n.at === undefined;
    const at = rep.at !== undefined ? rep.at : n.at || 0;
    const L = rep.edgeLength || (e ? G.primLength(e) : 0);
    const cL = (n.corners && n.corners.L) || {};
    const cR = (n.corners && n.corners.R) || {};
    const fil = commonValue([Number(cL.fillet) || 0, Number(cR.fillet) || 0]);
    const shape = Math.abs(n.depth - n.width / 2) < 1e-6 ? 'half circle' : n.depth < n.width / 2 ? 'shallow scoop' : 'oblong';
    const warn = rep.ok === false
      ? `<div class="warn">${rep.reason === 'overlap' ? 'This notch overlaps another notch on the same edge.' : rep.reason === 'curve' ? 'Notches only fit on straight edges.' : `The notch is wider than its edge (${fmt(L)} ${units()}).`}</div>`
      : '';
    return `${head('notch', 'Notch', `${fmt(n.width)} × ${fmt(n.depth)} ${units()} · ${shape}`)}
      ${warn}
      <div class="card"><h4>Size</h4><div class="grid2">
        <label class="fld"><span>Width</span>${numInput('id="notchW"', n.width)}</label>
        <label class="fld"><span>Depth</span>${numInput('id="notchD"', n.depth)}</label></div>
        <div class="chips"><button data-notch-depth="half">Half circle</button><button data-notch-depth="shallow">Shallow</button><button data-notch-depth="oblong">Oblong</button></div>
        <p class="note">Depth half the width makes a half circle; less makes a shallow scoop; more makes an oblong U.</p></div>
      <div class="card"><h4>Position</h4>
        <label class="switch"><span>Centred on the edge</span><input type="checkbox" id="notchCentred" ${centred ? 'checked' : ''}></label>
        ${centred ? '' : `<label class="fld" style="margin-top:8px"><span>Centre, from the ${ends[0]} end (edge is ${fmt(L)} ${units()})</span>${numInput('id="notchAt"', at)}</label>`}</div>
      <div class="card"><h4>${icon('corner')} Round where it meets the edge</h4>${radiusControl(fil, 'notch', true)}
        <p class="note">You can also round each side on its own with the Round corners tool.</p></div>
      <p class="note">Holes and stitching follow the notch when its edge has them.</p>
      <button class="small danger" id="delNotch">${icon('trash')} Delete notch</button>`;
  }

  function renderShapeInspector() {
    const pc = piece();
    const sh = shapeById(selected('shape')[0]);
    const c = sh;
    const b = RS.rawBox(c);
    const lay = curLay();
    const rep = (lay.resolved.report.shapes || {})[sh.id];
    const refs = shapeEdgeRefs(sh);
    const modes = refs.map((r) => (edgeTarget(r) || {}).mode || 'none');
    const no = shapeNo(sh.id);
    const targets = [`<option value="outline">the outline</option>`]
      .concat(pc.cutouts.map((o, i) => (o.id === sh.id ? '' : `<option value="${o.id}">shape ${i + 1}</option>`)))
      .join('');
    const al = (k, label) => `<button data-align="${k}">${label}</button>`;
    const op = sh.op || 'hole';
    const warn = rep && !rep.ok
      ? `<div class="warn">${rep.reason === 'apart' ? 'This shape doesn’t touch the outline, so it can’t be merged.' : 'This shape doesn’t overlap the outline, so nothing changes.'}</div>`
      : rep && rep.extra ? `<div class="warn">The result came apart into ${rep.extra + 1} parts; only the largest is kept.</div>` : '';
    return `${head('shape', `Shape ${no}`, `${sizeText(c)} · ${OP_SUB[op]}`)}
      <div class="card"><h4>Use it as</h4><div class="seg wide">${['hole', 'cut', 'merge', 'overlap']
        .map((k) => `<button class="${op === k ? 'on' : ''}" data-op="${k}">${OP_LABEL[k]}</button>`)
        .join('')}</div>
        <p class="note">${op === 'hole' ? 'A hole inside the piece, like a card slot.' : 'It stays a shape you can move, resize or switch back. The piece updates as you go.'}</p>${warn}</div>
      ${sizeCard(c, 'shape')}
      ${b ? `<div class="card"><h4>Position</h4><div class="grid2">
          <label class="fld"><span>Centre X</span>${numInput('id="posX"', (b.minX + b.maxX) / 2)}</label>
          <label class="fld"><span>Centre Y</span>${numInput('id="posY"', (b.minY + b.maxY) / 2)}</label></div>
        <div class="align-label">Line up with <select id="alignTarget" style="padding:2px 4px">${targets}</select></div>
        <div class="align-grid">${al('left', 'Left')}${al('hcenter', 'Centre')}${al('right', 'Right')}${al('top', 'Top')}${al('vmiddle', 'Middle')}${al('bottom', 'Bottom')}</div>
        <div class="align-label">Centre on its edge</div>
        <div class="align-grid four">${al('onTop', 'Top')}${al('onBottom', 'Bottom')}${al('onLeft', 'Left')}${al('onRight', 'Right')}</div>
        <p class="note">Or drag the shape on the drawing.</p></div>` : ''}
      <div class="card"><h4>${icon('edge')} Around this shape</h4>${modeSeg(commonValue(modes), 'data-shapemode')}</div>
      ${advancedSection(c)}
      <div class="row"><button class="small" id="chooseLines" title="Pick exactly which lines to keep">Choose lines…</button>
        <button class="small danger" id="delShape">${icon('trash')} Delete shape</button></div>`;
  }

  function renderDrawInspector() {
    const c = drawContour();
    const isOut = ui.drawTarget === 'outline';
    return `${head('pen', isOut ? 'Drawing the outline' : 'Drawing a shape', `${c.segments.length} line${c.segments.length === 1 ? '' : 's'} so far`)}
      <div class="tip">${icon('info')}<div>Click on the grid to place points. Click the first point (or press Enter) to close the shape. Hold Shift for straight 15° steps. You can fine-tune sizes afterwards.</div></div>
      <div class="row"><button class="primary" id="finishDraw">${icon('check')} Finish</button><button id="undoPoint" ${c.start ? '' : 'disabled'}>Remove last point</button></div>`;
  }

  function renderOriginInspector() {
    return `${head('target', 'Origin point', 'Click a hole or a stitch line')}
      <div class="tip">${icon('info')}<div>Click any hole, or anywhere on a stitch line. A hole stays put there and the others space out from it; on a stitch line a tick marks the spot on the print.</div></div>
      <button class="ghost" data-tool-start="select">Cancel</button>`;
  }

  function renderCombineInspector() {
    const kept = ui.combine.pieces.filter((x) => x.keep).length;
    return `${head('shape', 'Choose lines', `${kept} of ${ui.combine.pieces.length} kept`)}
      <div class="tip">${icon('info')}<div>The outline and shape ${shapeNo(ui.combine.id)} are split wherever they cross. Click a line to keep it (solid) or remove it (dashed). The kept lines must join into one closed shape.</div></div>
      <div class="warn">Applying makes the outline fixed: its notches and combined shapes become plain lines that can’t be edited as shapes any more.</div>
      <div class="card" style="margin-top:12px"><h4>Start from</h4><div class="seg wide">
        <button data-preset="cut">Cut away</button><button data-preset="merge">Merge</button><button data-preset="overlap">Overlap</button></div></div>
      <div class="row"><button class="primary" id="applyLines">Apply</button><button class="ghost" id="cancelLines">Cancel</button></div>`;
  }

  function renderRight() {
    validateSel();
    let html;
    if (ui.tool === 'draw') html = renderDrawInspector();
    else if (ui.combine) html = renderCombineInspector();
    else if (ui.tool === 'round') html = renderRoundInspector();
    else if (ui.tool === 'origin') html = renderOriginInspector();
    else if (ui.sel.type === 'edge') html = renderEdgeInspector();
    else if (ui.sel.type === 'corner') html = renderCornerInspector();
    else if (ui.sel.type === 'notch') html = renderNotchInspector();
    else if (ui.sel.type === 'shape') html = renderShapeInspector();
    else html = renderPieceInspector();
    $('#rightPanel').innerHTML = html;
    const at = $('#alignTarget');
    if (at) {
      at.value = ui.alignTarget;
      if (at.value !== ui.alignTarget) at.value = ui.alignTarget = 'outline';
    }
    const mixed = $('#selCorner[data-mixed]');
    if (mixed) mixed.indeterminate = true;
    const det = $('#advDetails');
    if (det) det.addEventListener('toggle', () => (ui.advOpen = det.open));
  }

  // Corners a radius control applies to.
  function radiusTargets(scope) {
    if (scope === 'sel') return selected('corner');
    if (scope === 'notch') {
      const id = selected('notch')[0];
      return id ? [`n:${id}:L`, `n:${id}:R`] : [];
    }
    return [];
  }

  // A radius picked: the brush takes it, other scopes apply it now.
  function applyRadius(scope, r, live) {
    if (scope === 'brush') {
      ui.brush = r;
      if (ui.tool !== 'round') {
        ui.tool = 'round';
        clearSel();
      }
      if (live) {
        renderCanvas();
        renderHint();
      } else renderAll();
      return;
    }
    setFillets(radiusTargets(scope), r);
    if (live) {
      layCache.key = null;
      renderCanvas();
    } else commit();
  }

  $('#rightPanel').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.radiusSlider) {
      // Live preview while dragging; the change event records it for undo.
      const scope = t.dataset.radiusSlider;
      const box = $(`[data-radius-input="${scope}"]`);
      if (box) box.value = fmt(Number(t.value));
      if (scope === 'brush') {
        ui.brush = Number(t.value);
        renderHint();
      } else applyRadius(scope, Number(t.value), true);
    }
  });

  function bad(input) {
    input.classList.add('bad');
    toast('That value isn’t valid.');
  }

  // Keep notches pointing at the right edges when outline edges change.
  function shiftNotches(fromIdx, delta, removedIdx) {
    const pc = piece();
    pc.notches = (pc.notches || []).filter((n) => n.edge !== removedIdx);
    pc.notches.forEach((n) => {
      if (n.edge >= fromIdx) n.edge += delta;
    });
  }

  $('#rightPanel').addEventListener('change', (e) => {
    const t = e.target;
    const pc = piece();
    if (t.dataset.radiusSlider) return applyRadius(t.dataset.radiusSlider, Number(t.value), false);
    if (t.dataset.radiusInput) {
      const v = M.parseLength(t.value, units());
      if (!Number.isFinite(v) || v < 0) return bad(t);
      return applyRadius(t.dataset.radiusInput, v, false);
    }
    if (t.id === 'pieceName') {
      pc.name = t.value.trim() || pc.name;
      return commit();
    }
    if (t.id === 'allCorners') {
      cornersOf(curLay().outline).forEach((cn) => {
        const tg = cornerTarget(cn.vref);
        if (tg) tg.corner = t.checked;
      });
      return commit();
    }
    if (t.id === 'selCorner') {
      selected('corner').forEach((v) => {
        const tg = cornerTarget(v);
        if (tg) tg.corner = t.checked;
      });
      return commit();
    }
    if (t.dataset.size) {
      const v = M.parseLength(t.value, units());
      if (!Number.isFinite(v) || v <= 0) return bad(t);
      const dim = t.dataset.dim;
      const w = dim === 'w' || dim === 'd' ? v : NaN;
      const h = dim === 'h' || dim === 'd' ? v : NaN;
      if (t.dataset.size === 'piece') {
        RS.resizePiece(pc, w, h);
        ui.view = null; // refit so the new size is in view
      }
      else {
        const sh = shapeById(selected('shape')[0]);
        if (sh) RS.resizeShape(sh, w, h);
      }
      return commit();
    }
    // Notch fields
    const n = ui.sel.type === 'notch' ? notchById(ui.sel.items[0]) : null;
    if (n) {
      if (t.id === 'notchW' || t.id === 'notchD') {
        const v = M.parseLength(t.value, units());
        if (!Number.isFinite(v) || v <= 0) return bad(t);
        if (t.id === 'notchW') n.width = v;
        else n.depth = v;
        return commit();
      }
      if (t.id === 'notchCentred') {
        const rep = curLay().resolved.report.notches[n.id] || {};
        n.at = t.checked ? null : round(rep.at !== undefined ? rep.at : 0);
        return commit();
      }
      if (t.id === 'notchAt') return parseInto(t, (v) => (n.at = v));
    }
    if (t.id === 'alignTarget') {
      ui.alignTarget = t.value;
      return undefined;
    }
    const c = advContour();
    if (t.id === 'posX' || t.id === 'posY') {
      const v = M.parseLength(t.value, units());
      const b = RS.rawBox(c);
      if (!Number.isFinite(v) || !b) return bad(t);
      if (t.id === 'posX') moveContour(c, v - (b.minX + b.maxX) / 2, 0);
      else moveContour(c, 0, v - (b.minY + b.maxY) / 2);
      return commit();
    }
    if (t.id === 'startX' || t.id === 'startY') {
      const v = M.parseLength(t.value, units());
      if (!Number.isFinite(v)) return bad(t);
      c.start = c.start || { x: 0, y: 0 };
      c.start[t.id === 'startX' ? 'x' : 'y'] = v;
      return commit();
    }
    let seg = null;
    if (t.dataset.eseg) {
      const r = parseRef(t.dataset.eseg);
      const owner = r.kind === 'o' ? pc.outline : shapeById(r.id);
      seg = owner && owner.segments[r.idx];
    } else if (t.dataset.seg !== undefined) seg = c.segments[Number(t.dataset.seg)];
    if (seg) {
      const key = t.dataset.key;
      if (key === 'type') {
        if (t.value === 'arc') Object.assign(seg, { type: 'arc', radius: seg.radius || (seg.length ? seg.length / 2 : 20), sweep: seg.sweep || 90 });
        else Object.assign(seg, { type: 'line', length: seg.length || (seg.radius ? seg.radius * G.rad(Math.abs(seg.sweep || 90)) : 20) });
        return commit();
      }
      if (key === 'length' || key === 'radius') {
        const v = M.parseLength(t.value, units());
        if (!Number.isFinite(v) || v <= 0) return bad(t);
        seg[key] = v;
      } else {
        const v = M.parseNumber(t.value);
        if (!Number.isFinite(v) || (key === 'sweep' && (v === 0 || Math.abs(v) > 360))) return bad(t);
        seg[key] = v;
      }
      return commit();
    }
    return undefined;
  });

  $('#rightPanel').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return undefined;
    const pc = piece();
    if (t.dataset.setmode) {
      setModes(selected('edge'), t.dataset.setmode);
      return commit();
    }
    if (t.dataset.allmode) {
      setModes(outlineEdgeRefs(), t.dataset.allmode);
      return commit();
    }
    if (t.dataset.shapemode) {
      const sh = shapeById(selected('shape')[0]);
      if (sh) setModes(shapeEdgeRefs(sh), t.dataset.shapemode);
      return commit();
    }
    if (t.dataset.radius !== undefined) return applyRadius(t.dataset.scope, Number(t.dataset.radius), false);
    if (t.dataset.selall === 'edge') {
      ui.sel = { type: 'edge', items: outlineEdgeRefs() };
      return renderAll();
    }
    if (t.dataset.selall === 'corner') {
      ui.sel = { type: 'corner', items: cornersOf(curLay().outline).map((c) => c.vref) };
      return renderAll();
    }
    if (t.dataset.deselect) {
      clearSel();
      return renderAll();
    }
    if (t.dataset.toolStart) {
      if (t.dataset.toolStart === 'draw-outline') return startDraw('outline');
      return setTool(t.dataset.toolStart);
    }
    if (t.dataset.op) {
      const sh = shapeById(selected('shape')[0]);
      if (!sh) return undefined;
      sh.op = t.dataset.op;
      return commit();
    }
    if (t.dataset.notchDepth) {
      const n = notchById(selected('notch')[0]);
      if (!n) return undefined;
      n.depth = round({ half: n.width / 2, shallow: n.width / 5, oblong: n.width }[t.dataset.notchDepth]);
      return commit();
    }
    if (t.dataset.delSeg !== undefined) {
      const c = advContour();
      const i = Number(t.dataset.delSeg);
      c.segments.splice(i, 1);
      if (c === pc.outline) {
        shiftNotches(i + 1, -1, i);
      }
      ui.sel = ui.sel.type === 'shape' ? ui.sel : { type: null, items: [] };
      return commit();
    }
    if (t.dataset.align) return alignShape(t.dataset.align);
    if (t.dataset.preset && ui.combine) {
      LT.boolean.preset(ui.combine.pieces, t.dataset.preset);
      return renderAll();
    }
    switch (t.id) {
      case 'addLine':
      case 'addArc': {
        const c = advContour();
        if (!c.start) c.start = { x: 0, y: 0 };
        const angle = round(G.endHeading(c));
        const mode = c === pc.outline ? 'holes' : 'none';
        // A notch on the old closing edge stays on the closing edge.
        if (c === pc.outline) (pc.notches || []).forEach((n) => {
          if (n.edge === c.segments.length) n.edge += 1;
        });
        c.segments.push(t.id === 'addLine'
          ? M.seg('line', { length: inch() ? 25.4 : 20, angle, mode })
          : M.seg('arc', { radius: inch() ? 12.7 : 15, sweep: 90, angle, mode }));
        return commit();
      }
      case 'redraw':
        return startDraw(advContour() === pc.outline ? 'outline' : advContour().id);
      case 'delShape':
      case 'delNotch':
        return deleteSelected();
      case 'addNotch': {
        const r = parseRef(selected('edge')[0]);
        const e = G.buildEdges(pc.outline).find((x) => x.edge === r.idx);
        if (!e) return undefined;
        const L = G.primLength(e);
        const w = round(Math.min(inch() ? 19.05 : 20, L * 0.6));
        const n = M.newNotch(r.idx, w, round(w / 2));
        pc.notches = pc.notches || [];
        pc.notches.push(n);
        ui.sel = { type: 'notch', items: [n.id] };
        return commit();
      }
      case 'chooseLines':
        return startChooseLines(selected('shape')[0]);
      case 'applyLines':
        return ui.combine && applyChooseLines();
      case 'cancelLines':
        ui.combine = null;
        return renderAll();
      case 'finishDraw':
        return finishDraw();
      case 'undoPoint': {
        const c = drawContour();
        if (c.segments.length) c.segments.pop();
        else c.start = null;
        return commit();
      }
      default:
        return undefined;
    }
  });

  // ---------------------------------------------------------------------
  // Aligning and combining shapes

  function alignShape(how) {
    const pc = piece();
    const c = shapeById(selected('shape')[0]);
    if (!c) return;
    const target = ui.alignTarget !== 'outline' ? shapeById(ui.alignTarget) : pc.outline;
    const S0 = RS.rawBox(c);
    const T = target && RS.rawBox(target);
    if (!S0 || !T) return;
    const scx = (S0.minX + S0.maxX) / 2;
    const scy = (S0.minY + S0.maxY) / 2;
    const moves = {
      left: [T.minX - S0.minX, 0],
      hcenter: [(T.minX + T.maxX) / 2 - scx, 0],
      right: [T.maxX - S0.maxX, 0],
      bottom: [0, T.minY - S0.minY],
      vmiddle: [0, (T.minY + T.maxY) / 2 - scy],
      top: [0, T.maxY - S0.maxY],
      onTop: [0, T.maxY - scy],
      onBottom: [0, T.minY - scy],
      onLeft: [T.minX - scx, 0],
      onRight: [T.maxX - scx, 0],
    };
    const [dx, dy] = moves[how];
    moveContour(c, dx, dy);
    commit();
  }

  // The outline as it is without shape `id`, for choosing lines.
  function outlineWithout(id) {
    const pc = piece();
    const tmp = { ...pc, cutouts: pc.cutouts.filter((c) => c.id !== id) };
    return RS.resolvePiece(tmp).outline;
  }

  function startChooseLines(id) {
    const sh = shapeById(id);
    const base = outlineWithout(id);
    if (!sh || !base) return;
    const A = G.buildPrimitives(base);
    const B = G.buildPrimitives(sh);
    ui.combine = { id, pieces: LT.boolean.preset(LT.boolean.splitShapes(A, B), sh.op && sh.op !== 'hole' ? sh.op : 'cut') };
    ui.tool = 'select';
    renderAll();
  }

  // Choosing lines by hand can't stay live, so it fixes the outline.
  function applyChooseLines() {
    const pc = piece();
    const id = ui.combine.id;
    const base = outlineWithout(id);
    const res = LT.boolean.combine(base, shapeById(id), null, ui.combine.pieces);
    if (!res.outline) {
      toast('The kept lines don’t join into a closed shape.');
      return;
    }
    const origin = pc.outline.origin;
    pc.outline = res.outline;
    if (origin) pc.outline.origin = origin;
    pc.notches = [];
    pc.cutouts = pc.cutouts.filter((c) => c.id !== id && !isLiveOp(c));
    res.holes.forEach((h) => pc.cutouts.push(M.newShape(h)));
    clearSel();
    ui.combine = null;
    commit();
    const notes = [];
    if (res.extra) notes.push(`The result came apart into ${res.extra + 1} parts; the largest was kept.`);
    if (res.open) notes.push('Some kept lines didn’t connect and were left out.');
    toast(notes.length ? notes.join(' ') : 'Done. Undo if it isn’t what you wanted.');
  }

  // ---------------------------------------------------------------------
  // Top bar, menus, saving, export

  function closeMenus() {
    $$('.menu').forEach((m) => (m.hidden = true));
  }
  function toggleMenu(sel) {
    const m = $(sel);
    const show = m.hidden;
    closeMenus();
    m.hidden = !show;
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) closeMenus();
  });

  function renderTop() {
    const nameEl = $('#projectName');
    if (document.activeElement !== nameEl) nameEl.value = project.name;
    $$('[data-units]').forEach((b) => b.classList.toggle('on', b.dataset.units === units()));
    $('#btnUndo').innerHTML = icon('undo');
    $('#btnRedo').innerHTML = icon('redo');
    $('#btnUndo').disabled = !history.undo.length;
    $('#btnRedo').disabled = !history.redo.length;
    const st = $('#saveState');
    st.textContent = ui.dirty ? 'Not saved' : ui.savedName ? 'Saved' : '';
    st.classList.toggle('unsaved', ui.dirty);
    document.title = `${project.name}${ui.dirty ? ' •' : ''} – Leather Templates`;
  }

  function renderAll() {
    renderTop();
    renderRail();
    renderLeft();
    renderRight();
    renderCanvas();
  }

  async function saveProject() {
    const name = project.name.trim();
    if (!name) {
      toast('Give the project a name first.');
      $('#projectName').focus();
      return;
    }
    if (S.exists(name) && ui.savedName !== name) {
      const ok = await confirmDialog('Replace saved project?', `A project called “${name}” is already saved. Replace it?`, 'Replace', true);
      if (!ok) return;
    }
    try {
      S.save(project);
    } catch (err) {
      toast('Couldn’t save in this browser. Try File → Download project file.');
      return;
    }
    ui.savedName = name;
    ui.dirty = false;
    renderTop();
    toast(`Saved “${name}”.`);
  }

  async function guardUnsaved() {
    if (!ui.dirty) return true;
    return confirmDialog('Unsaved changes', 'This project has changes that aren’t saved. Continue anyway?', 'Continue', true);
  }

  function loadProject(p, savedName = null) {
    project = p;
    ui.pieceIdx = 0;
    clearSel();
    ui.tool = 'select';
    ui.view = null;
    ui.savedName = savedName;
    ui.dirty = false;
    ui.combine = null;
    resetHistory();
    S.saveCurrent(project);
    renderAll();
  }

  async function openDialog() {
    const items = S.list();
    if (!items.length) {
      await dialog('Open project', '<p>No saved projects in this browser yet. Use Save to keep one, or File → Load project file.</p>', [{ label: 'Close', value: 'x' }]);
      return;
    }
    const body = `<ul class="saved-list">${items
      .map((it) => `<li><div class="name">${esc(it.name)}<div class="when">${it.savedAt ? new Date(it.savedAt).toLocaleString() : ''}</div></div>
        <button type="button" class="small primary" data-open="${esc(it.name)}">Open</button>
        <button type="button" class="icon-btn" data-remove="${esc(it.name)}" title="Delete" aria-label="Delete">${icon('trash')}</button></li>`)
      .join('')}</ul>`;
    let chosen = null;
    await dialog('Open project', body, [{ label: 'Close', value: 'x', cls: 'ghost' }], (dlg) => {
      $('#dialogBody', dlg).onclick = (e) => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.open) {
          chosen = t.dataset.open;
          dlg.close('open');
        } else if (t.dataset.remove) {
          S.remove(t.dataset.remove);
          t.closest('li').remove();
          toast(`Deleted “${t.dataset.remove}”.`);
        }
      };
    });
    if (chosen && (await guardUnsaved())) {
      const p = S.load(chosen);
      if (p) {
        loadProject(p, chosen);
        toast(`Opened “${chosen}”.`);
      }
    }
  }

  async function exportDialog() {
    const body = `
      <div class="export-opts">
        <button type="button" class="export-opt" data-export="pdf">${icon('pdf')}<strong>Printable PDF</strong><small>True 1:1 size to trace onto leather</small></button>
        <button type="button" class="export-opt" data-export="svg">${icon('laser')}<strong>Laser SVG</strong><small>Red = cut, blue = score</small></button>
      </div>
      <div class="grid2">
        <label class="fld"><span>Paper (PDF)</span><select id="paper">${Object.entries(P.PAPER).map(([k, v]) => `<option value="${k}" ${k === ui.paper ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <div class="fld"><span>Pieces</span><div class="check-list">${project.pieces
          .map((p, i) => `<label><input type="checkbox" data-exp="${i}" ${p.export === false ? '' : 'checked'}> ${esc(p.name)}</label>`)
          .join('')}</div></div>
      </div>
      <p class="note">Print the PDF at 100% / “Actual size”, then measure the check square on the page.</p>`;
    await dialog('Export', body, [{ label: 'Close', value: 'x', cls: 'ghost' }], (dlg) => {
      $('#dialogBody', dlg).onchange = (e) => {
        if (e.target.id === 'paper') ui.paper = e.target.value;
        if (e.target.dataset.exp !== undefined) project.pieces[Number(e.target.dataset.exp)].export = e.target.checked;
      };
      $('#dialogBody', dlg).onclick = (e) => {
        const t = e.target.closest('[data-export]');
        if (!t) return;
        const list = project.pieces.filter((p) => p.export !== false && p.outline.segments.length);
        if (!list.length) {
          toast('Tick at least one piece with a shape.');
          return;
        }
        const name = S.safeFilename(project.name);
        if (t.dataset.export === 'pdf') {
          S.downloadBinary(`${name}.pdf`, P.buildPdf(project, list, ui.paper), 'application/pdf');
          toast('PDF downloaded. Print at 100% / Actual size.');
        } else {
          S.download(`${name}.svg`, R.buildSvg(project, list), 'image/svg+xml');
          toast('SVG downloaded.');
        }
      };
    });
    commit();
  }

  $('#projectName').addEventListener('change', (e) => {
    project.name = e.target.value.trim() || 'Untitled project';
    commit();
  });
  $('#btnSave').addEventListener('click', saveProject);
  $('#btnExport').addEventListener('click', exportDialog);
  $('#btnFile').addEventListener('click', () => toggleMenu('#fileMenu'));
  $('#fileMenu').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-file]');
    if (!t) return;
    closeMenus();
    switch (t.dataset.file) {
      case 'new':
        if (await guardUnsaved()) loadProject(M.newProject());
        break;
      case 'open':
        openDialog();
        break;
      case 'download':
        S.download(`${S.safeFilename(project.name)}.leather.json`, JSON.stringify(project, null, 2), 'application/json');
        break;
      case 'load':
        $('#fileInput').click();
        break;
      default:
    }
  });
  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !(await guardUnsaved())) return;
    try {
      loadProject(M.normalizeProject(JSON.parse(await file.text())));
      toast(`Loaded “${project.name}”.`);
    } catch (err) {
      toast('That file isn’t a Leather Templates project.');
    }
  });
  $$('[data-units]').forEach((b) =>
    b.addEventListener('click', () => {
      project.units = b.dataset.units;
      commit();
    })
  );
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProject();
      return;
    }
    if (typing || $('#dialog').open) return;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
      return;
    }
    if (e.key === 'Shift') {
      ui.shift = true;
      if (ui.tool === 'draw') renderCanvas();
    }
    if (ui.tool === 'draw') {
      if (e.key === 'Enter' || e.key === 'Escape') finishDraw();
      if (e.key === 'Backspace') {
        e.preventDefault();
        const c = drawContour();
        if (c.segments.length) c.segments.pop();
        else c.start = null;
        commit();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (ui.combine) ui.combine = null;
      else if (ui.tool !== 'select') ui.tool = 'select';
      else clearSel();
      renderAll();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'v') setTool('select');
    else if (k === 'p') startDraw();
    else if (k === 'r') setTool('round');
    else if (k === 'o') setTool('origin');
    else if ((k === 'delete' || k === 'backspace') && (ui.sel.type === 'shape' || ui.sel.type === 'notch')) deleteSelected();
    else if (ui.sel.type === 'edge' && (k === 'h' || k === 's' || k === 'n')) {
      setModes(selected('edge'), { h: 'holes', s: 'stitch', n: 'none' }[k]);
      commit();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      ui.shift = false;
      if (ui.tool === 'draw') renderCanvas();
    }
  });
  window.addEventListener('resize', renderCanvas);

  renderAll();
  // Layout may settle after first paint.
  requestAnimationFrame(() => {
    ui.view = null;
    renderCanvas();
  });

  window.LT.app = {
    get project() {
      return project;
    },
    ui,
  };
})();
