// User interface: canvas editor, selection, inspector, saving and export.
//
// The canvas shows each piece as resolved by js/resolve.js. Every edge and
// corner on screen carries a reference back to where its settings live (the
// base outline, a notch, a shape, or a corner made by combining shapes), so
// clicking it edits the right thing and everything stays editable.
(function () {
  'use strict';
  const { model: M, geom: G, layout: Lay, render: R, pdf: P, storage: S, resolve: RS, assembly: AS } = window.LT;

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
    line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
    slot: '<rect x="8" y="3" width="8" height="18" rx="4"/>',
    align: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="7" y="14" width="10" height="4" rx="1"/>',
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
    sel: { type: null, items: [] }, // type: 'edge' | 'corner' | 'shape' | 'notch' | 'line' | null
    tool: 'select', // 'select' | 'draw' | 'round' | 'origin' | 'line' | 'trim'
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
    trim: null, // { pieces, loops } while trimming
    lineStart: null, // first point of a cut line being drawn
    linePick: null, // id of a new cut line waiting for a part to be picked
    guides: null, // { x, y } alignment guides while dragging
    mode: 'edit', // 'edit' | 'assemble'
    asmSel: null, // piece id picked in the assembly view
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
  const lineById = (id, pc = piece()) => (pc.lines || []).find((l) => l.id === id) || null;
  const lineReport = (id) => (curLay().resolved.report.lines || {})[id] || {};
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
    // Cut lines drawn across a shape move with it.
    if (c.id) linesOn(c.id).forEach((l) => {
      l.a = { x: round(l.a.x + dx), y: round(l.a.y + dy) };
      l.b = { x: round(l.b.x + dx), y: round(l.b.y + dy) };
    });
  }

  const linesOn = (target, pc = piece()) => (pc.lines || []).filter((l) => (l.target || 'outline') === target);
  function dropLinesOn(target, pc = piece()) {
    pc.lines = (pc.lines || []).filter((l) => (l.target || 'outline') !== target);
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
    if (p[0] === 'l') return { kind: 'l', id: p[1], end: p[2] || null };
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
    if (r.kind === 'l') return lineById(r.id);
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
    if (r.kind === 'l' && (r.end === 'a' || r.end === 'b')) {
      const ln = lineById(r.id);
      if (!ln) return null;
      ln.corners = ln.corners || {};
      ln.corners[r.end] = ln.corners[r.end] || { fillet: 0, corner: true };
      return ln.corners[r.end];
    }
    if (r.kind === 'n' && ['L', 'R', 'BL', 'BR'].includes(r.side)) {
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
    if (r.kind === 'l') return 'a line';
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
    if (t === 'shape') ui.sel.items = ui.sel.items.filter((id) => id === 'outline' || shapeById(id));
    else if (t === 'notch') ui.sel.items = ui.sel.items.filter((id) => notchById(id));
    else if (t === 'line') ui.sel.items = ui.sel.items.filter((id) => lineById(id));
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
    if (ui.linePick && !lineById(ui.linePick, pc)) ui.linePick = null;
  }

  function restore(snapshot) {
    project = JSON.parse(snapshot);
    history.last = snapshot;
    ui.pieceIdx = Math.min(ui.pieceIdx, project.pieces.length - 1);
    validateSel();
    if (ui.tool === 'draw' || ui.tool === 'trim') ui.tool = 'select';
    if (ui.asmSel && !project.pieces.some((x) => x.id === ui.asmSel)) ui.asmSel = null;
    ui.combine = null;
    ui.trim = null;
    ui.lineStart = null;
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
    } else if (kind === 'slot') {
      const v = await askLengths('Add a slot', [
        { key: 'w', label: 'Width', value: inch() ? 19.05 : 20, positive: true },
        { key: 'h', label: 'Length', value: inch() ? 38.1 : 40, positive: true },
      ], 'Add');
      if (!v) return;
      shape = M.slot(v.w, v.h, c.x, c.y, 'none');
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
      const ids = ui.sel.items.filter((id) => id !== 'outline');
      if (!ids.length) return;
      pc.cutouts = pc.cutouts.filter((c) => !ids.includes(c.id));
      ids.forEach((id) => dropLinesOn(id));
      toast(ids.length > 1 ? 'Shapes deleted. Undo brings them back.' : 'Shape deleted. Undo brings it back.');
    } else if (ui.sel.type === 'line') {
      pc.lines = (pc.lines || []).filter((l) => !ui.sel.items.includes(l.id));
      toast('Line deleted. Undo brings it back.');
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
      dropLinesOn('outline');
    } else if (target && target !== 'new') {
      ui.drawTarget = target;
      c = shapeById(target);
      dropLinesOn(target);
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
  // Cut lines: click two points; the line stretches to the edges it
  // crosses, then you click the part to cut away.

  // Snap to corners first, then onto edges, then the grid.
  function snapLinePoint(pt) {
    const lay = curLay();
    const tol = 10 / ui.view.scale;
    const all = [lay.outline, ...lay.cutouts];
    let best = null;
    all.forEach((lc) => {
      G.buildEdges(lc.contour).forEach((e) => {
        const v = G.primStart(e);
        const d = G.dist(v, pt);
        if (d <= tol && (!best || d < best.d)) best = { d, pt: v };
      });
    });
    if (best) return { ...best.pt, snapped: 'corner' };
    if (ui.lineStart && ui.shift) {
      const d = G.sub(pt, ui.lineStart);
      const a = Math.round(Math.atan2(d.y, d.x) / G.rad(15)) * G.rad(15);
      const L = G.len(d);
      return { x: ui.lineStart.x + L * Math.cos(a), y: ui.lineStart.y + L * Math.sin(a) };
    }
    all.forEach((lc) => {
      const n = lc.prims.length ? G.nearestOnPath(lc.prims, pt) : null;
      if (n && n.d <= tol && (!best || n.d < best.d)) best = n;
    });
    if (best) return { ...best.pt, snapped: 'edge' };
    if (ui.snap) {
      const st = minorStep();
      return { x: Math.round(pt.x / st) * st, y: Math.round(pt.y / st) * st };
    }
    return pt;
  }

  // What a new line cuts: the shape its middle is inside, else the outline.
  function lineTargetFor(a, b) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const pc = piece();
    for (let i = pc.cutouts.length - 1; i >= 0; i--) {
      const sh = pc.cutouts[i];
      const prims = G.buildPrimitives(sh);
      if (prims.length && pointInside(G.samplePoints(prims, 48), mid)) return sh.id;
    }
    return 'outline';
  }

  function pointInside(poly, pt) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  // Raw edges of what a line on `target` would cut right now.
  function lineTargetLoop(target) {
    const lay = curLay();
    if (target === 'outline') return G.buildEdges(lay.outline.contour);
    const lc = lay.cutouts.find((x) => x.src === target);
    if (lc) return G.buildEdges(lc.contour);
    const sh = shapeById(target);
    return sh ? G.buildEdges(sh) : [];
  }

  function addLinePoint(world) {
    const pt = snapLinePoint(world);
    const p = { x: round(pt.x), y: round(pt.y) };
    if (!ui.lineStart) {
      ui.lineStart = p;
      renderCanvas();
      renderRight();
      return;
    }
    const a = ui.lineStart;
    if (G.dist(a, p) < 1e-3) return;
    ui.lineStart = null;
    const ln = M.newLine(a, p, lineTargetFor(a, p));
    const pc = piece();
    pc.lines = pc.lines || [];
    pc.lines.push(ln);
    if (!lineReport(ln.id).ok) {
      pc.lines.pop();
      toast(ln.target === 'outline' ? 'That line doesn’t cross the piece.' : 'That line doesn’t cross the shape.');
      renderAll();
      return;
    }
    ui.linePick = ln.id;
    commit();
  }

  // Cut away one side of a line.
  function pickLinePart(id, side) {
    const ln = lineById(id);
    if (!ln) return;
    ln.remove = side;
    ui.linePick = null;
    ui.tool = 'select';
    ui.sel = { type: 'line', items: [id] };
    commit();
  }

  // The line whose parts are clickable right now, if any.
  function pickingLine() {
    if (ui.linePick) return ui.linePick;
    if (ui.sel.type === 'line' && ui.sel.items.length === 1) {
      const ln = lineById(ui.sel.items[0]);
      if (ln && !ln.remove) return ln.id;
    }
    return null;
  }

  // A plain name for an edge from where it sits ("Left edge").
  function edgeName(prim, box) {
    if (!prim) return 'Edge';
    if (prim.type !== 'line') return 'Curved edge';
    const u = G.norm(G.sub(prim.b, prim.a));
    const m = { x: (prim.a.x + prim.b.x) / 2, y: (prim.a.y + prim.b.y) / 2 };
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    if (Math.abs(u.y) < 0.26) return m.y > cy ? 'Top edge' : 'Bottom edge';
    if (Math.abs(u.x) < 0.26) return m.x < cx ? 'Left edge' : 'Right edge';
    return 'Slanted edge';
  }

  // ---------------------------------------------------------------------
  // Trim: every line is split where it crosses another; click the pieces
  // to remove and the rest joins up. Like Choose lines, the result is
  // fixed rather than live.

  function startTrim() {
    const lay = curLay();
    const B2 = LT.boolean;
    const loops = [];
    const tag = (contour) =>
      RS.ccwTagged(G.buildEdges(contour).map((e) => {
        const sg = edgeProps(contour, e.edge) || {};
        return { ...e, mode: sg.mode || 'none', fillet: Number(sg.fillet) || 0, corner: sg.corner !== false, vref: 'v' };
      }));
    if (lay.outline.prims.length) loops.push({ owner: 'outline', prims: tag(lay.outline.contour) });
    lay.cutouts.forEach((lc) => {
      // Holes made by combining shapes belong with the outline.
      if (lc.prims.length) loops.push({ owner: lc.src || 'outline', prims: tag(lc.contour) });
    });
    if (!loops.length) {
      toast('Nothing to trim yet.');
      return;
    }
    // Owners whose lines cross are trimmed together.
    const parent = {};
    const find = (k) => (parent[k] === undefined || parent[k] === k ? (parent[k] = k) : (parent[k] = find(parent[k])));
    loops.forEach((l) => find(l.owner));
    const pieces = [];
    loops.forEach((l, i) => {
      const others = loops.filter((x, j) => j !== i);
      others.forEach((o) => {
        if (o.owner !== l.owner && B2.splitLoop(l.prims, o.prims).length > l.prims.length) parent[find(l.owner)] = find(o.owner);
      });
      const parts = B2.splitLoop(l.prims, others.flatMap((o) => o.prims));
      parts.forEach((p) => pieces.push({ prim: p, owner: l.owner, keep: true }));
    });
    ui.trim = { pieces, loops, group: (k) => find(k) };
    ui.tool = 'trim';
    clearSel();
    renderAll();
  }

  function applyTrim() {
    const pc = piece();
    const T = ui.trim;
    const B2 = LT.boolean;
    const removed = T.pieces.filter((x) => !x.keep);
    if (!removed.length) {
      toast('Click the lines you want to remove first.');
      return;
    }
    const groups = [...new Set(removed.map((x) => T.group(x.owner)))];
    const results = [];
    for (const g of groups) {
      const owners = [...new Set(T.loops.map((l) => l.owner).filter((o) => T.group(o) === g))];
      const kept = T.pieces.filter((x) => x.keep && owners.includes(x.owner)).map((x) => ({ prim: x.prim, keep: true }));
      const { loops, open } = B2.trace(kept, 'merge');
      if (open) {
        toast('The lines left don’t join into closed shapes. Keep or remove a few more.');
        return;
      }
      // Corner settings come back from wherever a corner already was.
      const table = T.loops.filter((l) => owners.includes(l.owner)).flatMap((l) => l.prims.map((p) => ({ pt: G.primStart(p), fillet: p.fillet, corner: p.corner })));
      const contours = loops
        .map((loop) => {
          const l = G.signedArea(loop) > 0 ? loop : loop.slice().reverse().map(B2.reversePrim);
          return l.map((p) => {
            const hit = table.find((t) => G.dist(t.pt, G.primStart(p)) < 1e-4);
            return { ...p, fillet: hit ? hit.fillet : 0, corner: hit ? hit.corner : true };
          });
        })
        .sort((x, y) => G.signedArea(y) - G.signedArea(x))
        .map((l) => {
          const c = RS.primsToContour(l);
          c.segments.forEach((sg) => {
            delete sg.ref;
            delete sg.vref;
          });
          return c;
        });
      results.push({ owners, contours });
    }
    let extra = 0;
    results.forEach(({ owners, contours }) => {
      const shapes = owners.filter((o) => o !== 'outline');
      pc.cutouts = pc.cutouts.filter((c) => !shapes.includes(c.id));
      shapes.forEach((id) => dropLinesOn(id));
      let rest = contours;
      if (owners.includes('outline')) {
        if (!contours.length) return;
        const origin = pc.outline.origin;
        pc.outline = contours[0];
        if (origin) pc.outline.origin = origin;
        pc.notches = [];
        pc.cutouts.filter(isLiveOp).forEach((c) => dropLinesOn(c.id));
        pc.cutouts = pc.cutouts.filter((c) => !isLiveOp(c));
        dropLinesOn('outline');
        const poly = G.samplePoints(G.buildPrimitives(pc.outline), 48);
        rest = contours.slice(1).filter((c) => {
          const e = G.buildEdges(c)[0];
          const ok = e && pointInside(poly, G.primPointAt(e, G.primLength(e) / 2));
          if (!ok) extra++;
          return ok;
        });
      }
      rest.forEach((c) => pc.cutouts.push(M.newShape(c)));
    });
    ui.trim = null;
    ui.tool = 'select';
    clearSel();
    commit();
    toast(extra ? `Done. ${extra} part${extra === 1 ? '' : 's'} outside the piece ${extra === 1 ? 'was' : 'were'} left out.` : 'Trimmed. Undo if it isn’t what you wanted.');
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
    let b = ui.mode === 'assemble' ? asmBBox(AS.buildAssembly(project)) : Lay.pieceBBox(curLay());
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
    if (ui.mode === 'assemble') {
      renderAssemblyCanvas(w, h);
      return;
    }
    const s = ui.view.scale;
    const x0 = ui.view.cx - w / 2 / s;
    const y0 = -ui.view.cy - h / 2 / s;
    svg.setAttribute('viewBox', `${x0} ${y0} ${w / s} ${h / s}`);
    svg.setAttribute('class', `tool-${ui.tool}`);
    const px = (n) => n / s;
    const out = [gridSvg(x0, y0, w / s, h / s, s)];
    const pc = piece();
    const lay = curLay();
    const combining = ui.combine || ui.trim;
    const drawing = ui.tool === 'draw' || ui.tool === 'line';
    const contours = [{ lc: lay.outline, kind: 'outline' }, ...lay.cutouts.map((lc) => ({ lc, kind: 'cutout' }))];
    const selEdges = new Set(selected('edge'));
    const selNotch = new Set(selected('notch'));
    const selShape = new Set(selected('shape'));
    const selLine = new Set(selected('line'));
    const radii = radiiInUse(lay);
    const refOf = (lc, p) => {
      const sg = p.edge !== undefined ? edgeProps(lc.contour, p.edge) : null;
      return sg && sg.ref;
    };

    // Piece fill (Shift-click it to include the outline when lining up shapes)
    if (lay.outline.prims.length && !combining) {
      const on = selShape.has('outline');
      out.push(`<path d="${R.pathData(lay.outline.prims, flip, true)}" fill="color-mix(in srgb, var(--accent) ${on ? 12 : 5}%, transparent)" stroke="${on ? 'var(--accent)' : 'none'}" stroke-width="5" stroke-opacity="0.3" vector-effect="non-scaling-stroke" data-fill="1"/>`);
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
      if (combining && (kind === 'outline' || ui.trim)) return;
      const own = kind === 'cutout' && lc.src ? lc.src : null;
      if (kind === 'cutout' && !combining) {
        const on = own && selShape.has(own);
        out.push(`<path class="${own && !drawing ? 'grab' : ''}" d="${R.pathData(lc.prims, flip, true)}" fill="${on ? 'color-mix(in srgb, var(--accent) 14%, var(--canvas))' : 'var(--canvas)'}" stroke="none" ${own ? `data-shape="${own}"` : ''}/>`);
      }
      // Selection glow under selected edges and notches
      lc.prims.forEach((p) => {
        const ref = refOf(lc, p);
        const on = ref && (selEdges.has(ref) || (ref.startsWith('n:') && selNotch.has(ref.slice(2))) || (ref.startsWith('l:') && selLine.has(ref.slice(2))));
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

    // Cut lines that haven't cut anything yet, and the parts to pick from.
    if (!combining) {
      (pc.lines || []).forEach((ln) => {
        const rep = lineReport(ln.id);
        if (ln.remove || !rep.ok) return;
        const d = `M${num(rep.P.x)} ${num(-rep.P.y)}L${num(rep.Q.x)} ${num(-rep.Q.y)}`;
        const on = selLine.has(ln.id) || ui.linePick === ln.id;
        out.push(`<path d="${d}" stroke="var(--danger)" stroke-width="${on ? 2.2 : 1.6}" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        if (ui.tool === 'select') out.push(`<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" data-line="${ln.id}"/>`);
      });
      const pick = pickingLine();
      const rep = pick ? lineReport(pick) : null;
      if (rep && rep.ok) {
        ['left', 'right'].forEach((side) => {
          out.push(`<path class="part" d="${R.pathData(rep[side], flip, true)}" fill="color-mix(in srgb, var(--danger) 6%, transparent)" stroke="none" data-part="${side}"><title>Click to cut this part away</title></path>`);
        });
      }
    }

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
        if (ui.trim && !pcs.keep) return;
        // Ends of each piece, so you can see where lines were split.
        if (ui.trim) [G.primStart(pcs.prim), G.primEnd(pcs.prim)].forEach((q) => out.push(`<circle cx="${num(q.x)}" cy="${num(-q.y)}" r="${num(px(2.5))}" fill="var(--accent)" pointer-events="none"/>`));
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
    if (ui.tool === 'draw') {
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
    // Cut line being drawn
    if (ui.tool === 'line' && !ui.linePick && ui.mouse) {
      const m = snapLinePoint(ui.mouse);
      const dot = (q, big) => `<circle cx="${num(q.x)}" cy="${num(-q.y)}" r="${num(px(big ? 5 : 4))}" fill="${big ? 'var(--panel)' : 'var(--danger)'}" stroke="var(--danger)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      if (ui.lineStart) {
        const a = ui.lineStart;
        if (G.dist(a, m) > 1e-3) {
          const ch = RS.lineChord(lineTargetLoop(lineTargetFor(a, m)), a, m);
          if (ch) out.push(`<path d="M${num(ch.P.x)} ${num(-ch.P.y)}L${num(ch.Q.x)} ${num(-ch.Q.y)}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8" vector-effect="non-scaling-stroke"/>`);
        }
        out.push(`<path d="M${num(a.x)} ${num(-a.y)}L${num(m.x)} ${num(-m.y)}" stroke="var(--danger)" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
        out.push(dot(a, true));
      }
      out.push(dot(m, !!m.snapped));
    }

    // Alignment guides while dragging a shape
    if (ui.guides) {
      const g = ui.guides;
      const st = 'stroke="#d6336c" stroke-width="1.2" stroke-dasharray="6 3" vector-effect="non-scaling-stroke" pointer-events="none"';
      if (g.x !== null && g.x !== undefined) out.push(`<path d="M${num(g.x)} ${num(y0)}V${num(y0 + h / s)}" ${st}/>`);
      if (g.y !== null && g.y !== undefined) out.push(`<path d="M${num(x0)} ${num(-g.y)}H${num(x0 + w / s)}" ${st}/>`);
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
    } else if (ui.trim) {
      msg = 'Click the lines to remove (they turn dashed), then Apply · Esc to cancel';
    } else if (ui.tool === 'line') {
      msg = ui.linePick
        ? 'Click the part to cut away · Esc to drop the line'
        : ui.lineStart
          ? 'Click the second point · it stretches to the edges · Shift for 15° steps'
          : 'Click the first point of the line · it snaps to corners and edges';
    } else if (ui.tool === 'origin') {
      msg = 'Click a hole or a stitch line to make it the origin point · Esc to cancel';
    } else if (ui.tool === 'round') {
      msg = `Click corners to round them ${fmt(ui.brush || 0)} ${units()} · click again to make sharp · Esc when done`;
    } else if (ui.sel.type === 'edge' || ui.sel.type === 'corner') {
      msg = 'Shift-click to select more · Esc to deselect';
    } else if (ui.sel.type === 'shape') {
      msg = 'Drag to move · Shift-click more shapes (or inside the piece) to line them up · Delete to remove';
    } else if (ui.sel.type === 'line') {
      msg = pickingLine() ? 'Click the part to cut away' : 'Change the line on the right · Delete to remove';
    } else if (ui.sel.type === 'notch') {
      msg = 'Change the notch on the right · Delete to remove';
    } else {
      msg = 'Click an edge, corner or shape to change it · Shift-click shapes to line them up · drag to pan, scroll to zoom';
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
    if (ui.mode === 'assemble') {
      const el = target && target.closest ? target.closest('[data-asm]') : null;
      ui.asmSel = el ? el.dataset.asm : null;
      renderAll();
      return;
    }
    if (ui.tool === 'draw') {
      addDrawPoint(world);
      return;
    }
    const part = target && target.closest ? target.closest('[data-part]') : null;
    if (part && pickingLine()) {
      pickLinePart(pickingLine(), part.dataset.part);
      return;
    }
    if (ui.tool === 'line') {
      if (ui.linePick) toast('Click the part you want to cut away.');
      else addLinePoint(world);
      return;
    }
    if (ui.combine || ui.trim) {
      const pe = target && target.closest ? target.closest('[data-piece]') : null;
      if (pe) {
        const pcs = (ui.combine || ui.trim).pieces[Number(pe.dataset.piece)];
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
    const el = target && target.closest ? target.closest('[data-ref],[data-vref],[data-shape],[data-line]') : null;
    if (ui.tool === 'round') {
      if (el && el.dataset.vref) brushCorner(el.dataset.vref);
      else toast('Click a corner dot to round it.');
      return;
    }
    // Shift-click shapes, or inside the piece for the outline, to pick
    // several things to line up.
    const fill = !el && target && target.dataset && target.dataset.fill;
    if ((el && el.dataset.shape) || (fill && shiftKey)) {
      const id = el ? el.dataset.shape : 'outline';
      if (shiftKey && (ui.sel.type === 'shape' || ui.sel.type === null)) {
        const items = ui.sel.type === 'shape' ? ui.sel.items.slice() : [];
        const k = items.indexOf(id);
        if (k >= 0) items.splice(k, 1);
        else items.push(id);
        ui.sel = items.length ? { type: 'shape', items } : { type: null, items: [] };
      } else ui.sel = { type: 'shape', items: [id] };
      renderAll();
      return;
    }
    if (!el) {
      clearSel();
      renderAll();
      return;
    }
    if (el.dataset.line || (el.dataset.ref && el.dataset.ref.startsWith('l:'))) {
      ui.sel = { type: 'line', items: [el.dataset.line || parseRef(el.dataset.ref).id] };
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

  // ---------------------------------------------------------------------
  // Dragging shapes, with guides that snap to the centres and sides of the
  // outline and the other shapes.

  function startDrag(list) {
    const pc = piece();
    const ids = list.map((sh) => sh.id);
    const boxes = list.map((sh) => RS.rawBox(sh)).filter(Boolean);
    const box = {
      minX: Math.min(...boxes.map((b) => b.minX)),
      maxX: Math.max(...boxes.map((b) => b.maxX)),
      minY: Math.min(...boxes.map((b) => b.minY)),
      maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
    // Lines to snap to: centre first, then sides.
    const targets = [];
    const addBox = (b) => {
      if (!b) return;
      targets.push({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, centre: true });
      targets.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    };
    const ob = curLay().outline.prims.length ? G.bbox(curLay().outline.prims) : null;
    addBox(ob);
    pc.cutouts.forEach((sh) => {
      if (!ids.includes(sh.id)) addBox(RS.rawBox(sh));
    });
    return {
      ids,
      box,
      targets,
      items: list.map((sh) => ({
        id: sh.id,
        start: { ...sh.start },
        origin: sh.origin ? { ...sh.origin } : null,
        lines: linesOn(sh.id).map((l) => ({ id: l.id, a: { ...l.a }, b: { ...l.b } })),
      })),
    };
  }

  function dragTo(d, mx, my) {
    const tol = 8 / ui.view.scale;
    const b = d.box;
    // Moving box: its centre lines up with a centre, its sides with sides.
    const snapAxis = (axis, move) => {
      const lo = axis === 'x' ? b.minX : b.minY;
      const hi = axis === 'x' ? b.maxX : b.maxY;
      const mid = (lo + hi) / 2;
      let best = null;
      d.targets.forEach((t) => {
        const v = t[axis];
        const mine = t.centre ? [mid] : [lo, hi, mid];
        mine.forEach((m) => {
          const gap = Math.abs(m + move - v);
          // A centre in reach always wins over a side.
          const score = gap + (t.centre && m === mid ? 0 : tol);
          if (gap <= tol && (!best || score < best.score)) best = { score, move: v - m, at: v };
        });
      });
      if (best) return best;
      if (ui.snap) {
        const st = minorStep();
        return { move: Math.round(move / st) * st, at: null };
      }
      return { move, at: null };
    };
    const sx = snapAxis('x', mx);
    const sy = snapAxis('y', my);
    ui.guides = { x: sx.at, y: sy.at };
    d.items.forEach((it) => {
      const sh = shapeById(it.id);
      if (!sh) return;
      sh.start = { x: round(it.start.x + sx.move), y: round(it.start.y + sy.move) };
      if (it.origin) sh.origin = { x: it.origin.x + sx.move, y: it.origin.y + sy.move };
      it.lines.forEach((l0) => {
        const l = lineById(l0.id);
        if (!l) return;
        l.a = { x: round(l0.a.x + sx.move), y: round(l0.a.y + sy.move) };
        l.b = { x: round(l0.b.x + sx.move), y: round(l0.b.y + sy.move) };
      });
    });
    if (!(ui.sel.type === 'shape' && d.ids.every((id) => ui.sel.items.includes(id)))) ui.sel = { type: 'shape', items: d.ids.slice() };
  }

  svg.addEventListener('pointerdown', (e) => {
    ui.ptr = { x: e.clientX, y: e.clientY, cx: ui.view.cx, cy: ui.view.cy, moved: false, target: e.target, button: e.button, shift: e.shiftKey };
    if (ui.mode === 'assemble') {
      const el = e.button === 0 && e.target.closest ? e.target.closest('[data-asm]') : null;
      if (el) {
        const en = asmEntry(el.dataset.asm);
        ui.ptr.asmDrag = { id: el.dataset.asm, dx: Number(en.dx) || 0, dy: Number(en.dy) || 0 };
      }
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const grab = e.button === 0 && ui.tool === 'select' && !ui.combine && !e.shiftKey && e.target.closest
      ? e.target.closest('[data-shape]')
      : null;
    if (grab) {
      const sh = shapeById(grab.dataset.shape);
      // Dragging one of several selected shapes moves them all.
      const ids = ui.sel.type === 'shape' && ui.sel.items.includes(sh && sh.id) ? ui.sel.items.filter((x) => x !== 'outline') : [sh && sh.id];
      const list = ids.map((id) => shapeById(id)).filter((x) => x && x.start);
      if (list.length) ui.ptr.drag = startDrag(list);
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
      if (ui.ptr.moved && ui.ptr.asmDrag) {
        const d = ui.ptr.asmDrag;
        let mx = dx / ui.view.scale;
        let my = -dy / ui.view.scale;
        if (ui.snap) {
          const st = minorStep();
          mx = Math.round(mx / st) * st;
          my = Math.round(my / st) * st;
        }
        const en = asmEntry(d.id, true);
        en.dx = round(d.dx + mx);
        en.dy = round(d.dy + my);
        ui.asmSel = d.id;
      } else if (ui.ptr.moved && ui.ptr.drag) {
        dragTo(ui.ptr.drag, dx / ui.view.scale, -dy / ui.view.scale);
      } else if (ui.ptr.moved) {
        ui.view.cx = ui.ptr.cx - dx / ui.view.scale;
        ui.view.cy = ui.ptr.cy + dy / ui.view.scale;
      }
      if (ui.ptr.moved) renderCanvas();
    } else if (ui.tool === 'draw' || ui.tool === 'line') {
      renderCanvas();
    }
  });
  svg.addEventListener('pointerup', (e) => {
    const p = ui.ptr;
    ui.ptr = null;
    if (p && p.asmDrag && p.moved) {
      commit();
      return;
    }
    if (p && p.drag && p.moved) {
      ui.guides = null;
      commit();
      return;
    }
    if (p && !p.moved && p.button === 0) handleCanvasClick(p.target, toWorld(e), p.shift);
  });
  svg.addEventListener('pointerleave', () => {
    if (!ui.ptr && (ui.tool === 'draw' || ui.tool === 'line')) {
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
    if (ui.trim && tool !== 'trim') {
      ui.trim = null;
      if (ui.tool === 'trim') ui.tool = 'select';
    }
    ui.lineStart = null;
    ui.linePick = null;
    if (ui.tool === 'draw' && tool !== 'draw') finishDraw();
    if (tool === 'trim') {
      if (ui.tool === 'trim') {
        ui.trim = null;
        ui.tool = 'select';
        renderAll();
      } else startTrim();
      return;
    }
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
      btn('data-tool="line"', 'line', 'Line: cut across the piece (L)', ui.tool === 'line'),
      btn('data-tool="trim"', 'scissors', 'Trim lines (T)', ui.tool === 'trim'),
      '<hr>',
      btn('data-add="rect"', 'rect', 'Add a rectangle', false),
      btn('data-add="circle"', 'circle', 'Add a circle', false),
      btn('data-add="slot"', 'slot', 'Add a slot', false),
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

  // Whether any edge in the project is set to a stitch line.
  function usesStitchLine() {
    const has = (c) => c && ((c.segments || []).some((sg) => sg.mode === 'stitch') || (c.closing && c.closing.mode === 'stitch'));
    return project.pieces.some((pc) => has(pc.outline) || pc.cutouts.some(has) || (pc.lines || []).some((l) => l.mode === 'stitch'));
  }

  function settingsFields(obj) {
    return [
      ['holeDiameter', 'Hole size', 'Diameter of your round punch'],
      ['spacing', 'Spacing', 'Centre to centre of neighbouring holes'],
      ['edgeDistance', 'Holes from edge', 'Gap between the side of the hole and the leather edge'],
      usesStitchLine() ? ['stitchOffset', 'Line from edge', 'Distance of the stitch line from the edge, for edges set to Stitch line'] : null,
    ]
      .filter(Boolean)
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
    const square = n.shape === 'square';
    const shape = square ? 'square' : Math.abs(n.depth - n.width / 2) < 1e-6 ? 'half circle' : n.depth < n.width / 2 ? 'shallow scoop' : 'oblong';
    const bl = (n.corners && n.corners.BL) || {};
    const br = (n.corners && n.corners.BR) || {};
    const bfil = commonValue([Number(bl.fillet) || 0, Number(br.fillet) || 0]);
    const warn = rep.ok === false
      ? `<div class="warn">${rep.reason === 'overlap' ? 'This notch overlaps another notch on the same edge.' : rep.reason === 'curve' ? 'Notches only fit on straight edges.' : `The notch is wider than its edge (${fmt(L)} ${units()}).`}</div>`
      : '';
    return `${head('notch', 'Notch', `${fmt(n.width)} × ${fmt(n.depth)} ${units()} · ${shape}`)}
      ${warn}
      <div class="card"><h4>Shape</h4><div class="seg wide">
        <button class="${square ? '' : 'on'}" data-notchshape="round">Round</button><button class="${square ? 'on' : ''}" data-notchshape="square">Square</button></div></div>
      <div class="card"><h4>Size</h4><div class="grid2">
        <label class="fld"><span>Width</span>${numInput('id="notchW"', n.width)}</label>
        <label class="fld"><span>Depth</span>${numInput('id="notchD"', n.depth)}</label></div>
        ${square ? '' : `<div class="chips"><button data-notch-depth="half">Half circle</button><button data-notch-depth="shallow">Shallow</button><button data-notch-depth="oblong">Oblong</button></div>
        <p class="note">Depth half the width makes a half circle; less makes a shallow scoop; more makes an oblong U.</p>`}</div>
      <div class="card"><h4>Position</h4>
        <label class="switch"><span>Centred on the edge</span><input type="checkbox" id="notchCentred" ${centred ? 'checked' : ''}></label>
        ${centred ? '' : `<label class="fld" style="margin-top:8px"><span>Centre, from the ${ends[0]} end (edge is ${fmt(L)} ${units()})</span>${numInput('id="notchAt"', at)}</label>`}</div>
      <div class="card"><h4>${icon('corner')} Round where it meets the edge</h4>${radiusControl(fil, 'notch', true)}
        <p class="note">You can also round each side on its own with the Round corners tool.</p></div>
      ${square ? `<div class="card"><h4>${icon('corner')} Round the bottom corners</h4>${radiusControl(bfil, 'notchBottom', true)}</div>` : ''}
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

  function renderLineInspector() {
    const ln = lineById(selected('line')[0]);
    const rep = lineReport(ln.id);
    const where = ln.target === 'outline' ? 'Across the outline' : `Across shape ${shapeNo(ln.target)}`;
    const del = `<button class="small danger" id="delLine">${icon('trash')} Delete line</button>`;
    if (!rep.ok) {
      return `${head('line', 'Line', where)}
        <div class="warn">This line doesn’t cross ${ln.target === 'outline' ? 'the piece' : 'its shape'} any more, so it does nothing.</div>${del}`;
    }
    if (!ln.remove) {
      return `${head('line', 'Line', where)}
        <div class="tip">${icon('info')}<div>Click the part on the drawing you want to cut away.</div></div>${del}`;
    }
    const box = ln.target === 'outline' ? RS.rawBox(piece().outline) : RS.rawBox(shapeById(ln.target));
    const ends = rep.ends || {};
    const endRow = (k) => {
      const e = ends[k];
      if (!e) return '';
      return `<label class="fld"><span>${edgeName(e.prim, box || { minX: 0, maxX: 0, minY: 0, maxY: 0 })} kept</span>${numInput(`data-lineend="${k}"`, e.kept)}</label>`;
    };
    const lens = ['a', 'b'].filter((k) => ends[k]).map((k) => `${edgeName(ends[k].prim, box || { minX: 0, maxX: 0, minY: 0, maxY: 0 }).toLowerCase()} ${fmt(ends[k].length)} ${units()}`);
    return `${head('line', 'Line', `${where} · ${fmt(G.dist(rep.P, rep.Q))} ${units()} long`)}
      <div class="card"><h4>${icon('edge')} Along the cut</h4>${modeSeg(ln.mode || 'none', 'data-linemode')}
        <p class="note">The new edge starts with no holes.</p></div>
      <div class="card"><h4>Where it meets the edges</h4><div class="grid2">${endRow('a')}${endRow('b')}</div>
        <p class="note">Type how much of each edge to keep and the line moves to match. Before the cut: ${lens.join(', ')}.</p></div>
      <div class="row"><button class="small" id="swapLine">Cut away the other part</button>${del}</div>
      <p class="note">Round its corners with the Round corners tool.</p>`;
  }

  function renderLineToolInspector() {
    return `${head('line', 'Line', ui.linePick ? 'Pick the part to cut away' : ui.lineStart ? 'Click the second point' : 'Click the first point')}
      <div class="tip">${icon('info')}<div>Click two points. They snap to corners and edges, and the line stretches on its own to the edges it crosses. Then click the part to cut away. Draw it across a shape to cut the shape instead.</div></div>
      <button class="ghost" data-tool-start="select">${ui.linePick ? 'Keep without cutting' : 'Cancel'}</button>`;
  }

  function renderTrimInspector() {
    const n = ui.trim.pieces.filter((x) => !x.keep).length;
    return `${head('scissors', 'Trim', n ? `${n} line${n === 1 ? '' : 's'} to remove` : 'Click lines to remove')}
      <div class="tip">${icon('info')}<div>Every line is split where it crosses another. Click the pieces you want gone (they turn dashed); what’s left joins into one shape.</div></div>
      <div class="warn">The trimmed result is fixed lines. If the outline changes, its notches, lines and combined shapes become plain lines too.</div>
      <div class="row" style="margin-top:12px"><button class="primary" id="applyTrim" ${n ? '' : 'disabled'}>Apply</button><button class="ghost" id="cancelTrim">Cancel</button></div>`;
  }

  // Several things picked with Shift: line them up.
  function renderMultiInspector() {
    const items = selected('shape');
    const anchor = items.includes('outline') ? 'outline' : items[0];
    const name = (id) => (id === 'outline' ? 'Outline' : `Shape ${shapeNo(id)}`);
    const al = (k, label) => `<button data-alignmany="${k}">${label}</button>`;
    const moving = items.filter((id) => id !== anchor).length;
    return `${head('align', `${items.length} selected`, `Lining up to ${anchor === 'outline' ? 'the outline' : name(anchor).toLowerCase()}`)}
      <div class="multi-list">${items.map((id) => `<span class="${id === anchor ? 'anchor' : ''}">${name(id)}</span>`).join('')}</div>
      <div class="card"><h4>${icon('align')} Line up</h4>
        <div class="align-grid two">${al('hcenter', 'Centre left–right')}${al('vmiddle', 'Centre up–down')}</div>
        <button class="small block" data-alignmany="centre" style="margin-bottom:8px">Centre both ways</button>
        <div class="align-grid four">${al('left', 'Left')}${al('right', 'Right')}${al('top', 'Top')}${al('bottom', 'Bottom')}</div>
        <p class="note">${moving ? `${moving === 1 ? 'The other one moves' : `The other ${moving} move`} to match ${anchor === 'outline' ? 'the outline' : 'the first one you picked'}.` : 'Shift-click another shape to line it up.'} Shift-click inside the piece to line up with the outline.</p></div>
      <div class="row">${items.some((x) => x !== 'outline') ? `<button class="small danger" id="delShape">${icon('trash')} Delete shapes</button>` : ''}<button class="small ghost" data-deselect="1">Done</button></div>`;
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
    else if (ui.trim) html = renderTrimInspector();
    else if (ui.tool === 'line') html = renderLineToolInspector();
    else if (ui.tool === 'round') html = renderRoundInspector();
    else if (ui.tool === 'origin') html = renderOriginInspector();
    else if (ui.sel.type === 'edge') html = renderEdgeInspector();
    else if (ui.sel.type === 'corner') html = renderCornerInspector();
    else if (ui.sel.type === 'notch') html = renderNotchInspector();
    else if (ui.sel.type === 'line') html = renderLineInspector();
    else if (ui.sel.type === 'shape') html = ui.sel.items.length > 1 || ui.sel.items[0] === 'outline' ? renderMultiInspector() : renderShapeInspector();
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
    if (scope === 'notchBottom') {
      const id = selected('notch')[0];
      return id ? [`n:${id}:BL`, `n:${id}:BR`] : [];
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
        if (sh) RS.resizeShape(sh, w, h, pc.lines);
      }
      return commit();
    }
    if (t.dataset.lineend) {
      const ln = lineById(selected('line')[0]);
      const rep = ln && lineReport(ln.id);
      const end = rep && rep.ends && rep.ends[t.dataset.lineend];
      const v = M.parseLength(t.value, units());
      if (!end || !Number.isFinite(v) || v < 0 || v > end.length + 1e-6) return bad(t);
      const sAt = end.fromStart ? v : end.length - v;
      const q = G.primPointAt(end.prim, Math.max(0, Math.min(end.length, sAt)));
      const pt = { x: round(q.x), y: round(q.y) };
      // Pin both ends onto the edges so the other end stays put.
      if (t.dataset.lineend === 'a') {
        ln.a = pt;
        ln.b = { x: round(rep.Q.x), y: round(rep.Q.y) };
      } else {
        ln.a = { x: round(rep.P.x), y: round(rep.P.y) };
        ln.b = pt;
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
    if (t.dataset.linemode) {
      const ln = lineById(selected('line')[0]);
      if (ln) ln.mode = t.dataset.linemode;
      return commit();
    }
    if (t.dataset.alignmany) return alignMany(t.dataset.alignmany);
    if (t.dataset.notchshape) {
      const n = notchById(selected('notch')[0]);
      if (!n) return undefined;
      n.shape = t.dataset.notchshape;
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
      case 'delLine':
        return deleteSelected();
      case 'swapLine': {
        const ln = lineById(selected('line')[0]);
        if (ln) ln.remove = ln.remove === 'left' ? 'right' : 'left';
        return commit();
      }
      case 'applyTrim':
        return ui.trim && applyTrim();
      case 'cancelTrim':
        ui.trim = null;
        ui.tool = 'select';
        return renderAll();
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

  // Line up several shapes with the outline (when it is picked) or with
  // the first shape picked.
  function alignMany(how) {
    const pc = piece();
    const items = selected('shape');
    const anchor = items.includes('outline') ? 'outline' : items[0];
    const T = anchor === 'outline' ? (curLay().outline.prims.length ? G.bbox(curLay().outline.prims) : null) : RS.rawBox(shapeById(anchor));
    if (!T) return;
    items.filter((id) => id !== anchor && id !== 'outline').forEach((id) => {
      const c = shapeById(id);
      const S0 = c && RS.rawBox(c);
      if (!S0) return;
      const scx = (S0.minX + S0.maxX) / 2;
      const scy = (S0.minY + S0.maxY) / 2;
      const tcx = (T.minX + T.maxX) / 2;
      const tcy = (T.minY + T.maxY) / 2;
      const moves = {
        hcenter: [tcx - scx, 0],
        vmiddle: [0, tcy - scy],
        centre: [tcx - scx, tcy - scy],
        left: [T.minX - S0.minX, 0],
        right: [T.maxX - S0.maxX, 0],
        bottom: [0, T.minY - S0.minY],
        top: [0, T.maxY - S0.maxY],
      };
      const [dx, dy] = moves[how];
      moveContour(c, dx, dy);
    });
    if (!pc) return;
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
    dropLinesOn('outline');
    dropLinesOn(id);
    pc.cutouts.filter(isLiveOp).forEach((c) => dropLinesOn(c.id));
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
  // Assembly view: every piece stacked flat, lined up by origin point, in
  // its own colour; holes that should share a stitch but don't are flagged.

  function asmEntry(id, create = false) {
    project.assembly = project.assembly || { pieces: {} };
    project.assembly.pieces = project.assembly.pieces || {};
    const cur = project.assembly.pieces[id];
    if (cur) return cur;
    const e = { on: true, dx: 0, dy: 0, rot: 0, flip: false };
    if (create) project.assembly.pieces[id] = e;
    return e;
  }

  function asmBBox(asm) {
    const prims = asm.shown.flatMap((it) => it.outline);
    return prims.length ? G.bbox(prims) : null;
  }

  function setMode(mode) {
    if (ui.mode === mode) return;
    if (ui.tool === 'draw') finishDraw();
    ui.tool = 'select';
    ui.combine = null;
    ui.trim = null;
    ui.lineStart = null;
    ui.linePick = null;
    ui.mode = mode;
    ui.view = null;
    clearSel();
    renderAll();
  }

  // The stack as SVG markup (y flipped). Shared by the canvas and the
  // downloaded picture.
  function assemblySvg(asm, opts = {}) {
    const out = [];
    const px = opts.px || ((n) => n / 3.78);
    const bad = new Set(asm.check.bad.map((x) => x));
    asm.shown.forEach((it) => {
      const on = opts.sel === it.piece.id;
      const d = R.pathData(it.outline, flip, true) + it.cutouts.map((c) => R.pathData(c, flip, true)).join('');
      out.push(`<path class="asm" d="${d}" fill="${it.color}" fill-opacity="0.13" fill-rule="evenodd" stroke="${it.color}" stroke-width="${on ? 3 : 1.6}" vector-effect="non-scaling-stroke" data-asm="${it.piece.id}"/>`);
      it.stitch.forEach((st) => out.push(`<path d="${R.pathData(st.prims, flip, st.closed)}" fill="none" stroke="${it.color}" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`));
      it.holes.forEach((h) => out.push(`<circle cx="${num(h.x)}" cy="${num(-h.y)}" r="${num(it.holeRadius)}" fill="none" stroke="${it.color}" stroke-width="1.1" vector-effect="non-scaling-stroke" pointer-events="none"/>`));
    });
    // Flagged holes on top of everything
    bad.forEach((x) => {
      out.push(`<circle cx="${num(x.pt.x)}" cy="${num(-x.pt.y)}" r="${num(Math.max(x.item.holeRadius * 1.9, px(6)))}" fill="#e03131" fill-opacity="0.25" stroke="#e03131" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"><title>${esc(x.item.piece.name)}: no matching hole in ${esc(x.other.piece.name)}</title></circle>`);
    });
    // Shared origin
    const o = asm.shown.find((it) => it.hasOrigin);
    if (o) {
      const r = px(7);
      out.push(`<g stroke="var(--zero, #ea580c)" stroke-width="2" fill="none" pointer-events="none"><circle cx="${num(o.origin.x)}" cy="${num(-o.origin.y)}" r="${num(r)}" vector-effect="non-scaling-stroke"/><path d="M${num(o.origin.x - r * 1.7)} ${num(-o.origin.y)}H${num(o.origin.x + r * 1.7)}M${num(o.origin.x)} ${num(-o.origin.y - r * 1.7)}V${num(-o.origin.y + r * 1.7)}" vector-effect="non-scaling-stroke"/></g>`);
    }
    return out.join('');
  }

  function renderAssemblyCanvas(w, h) {
    const s = ui.view.scale;
    const x0 = ui.view.cx - w / 2 / s;
    const y0 = -ui.view.cy - h / 2 / s;
    svg.setAttribute('viewBox', `${x0} ${y0} ${w / s} ${h / s}`);
    svg.setAttribute('class', 'mode-assemble');
    const asm = AS.buildAssembly(project);
    svg.innerHTML = gridSvg(x0, y0, w / s, h / s, s) + assemblySvg(asm, { px: (n) => n / s, sel: ui.asmSel });
    const bad = asm.check.bad.length;
    $('#hint').textContent = !asm.shown.length
      ? 'Tick the pieces to stack on the left.'
      : `${bad ? `${bad} hole${bad === 1 ? '' : 's'} don’t line up (red)` : 'All shared holes line up'} · drag a piece to move it · scroll to zoom`;
    renderZoom();
  }

  function renderAssemblyLeft() {
    const asm = AS.buildAssembly(project);
    const rows = asm.items
      .map((it) => `<div class="asm-row ${ui.asmSel === it.piece.id ? 'on' : ''}" data-asm-pick="${it.piece.id}">
          <input type="checkbox" data-asm-on="${it.piece.id}" ${it.on ? 'checked' : ''} aria-label="Show ${esc(it.piece.name)}">
          <i class="swatch" style="background:${it.color}"></i>
          <span class="name">${esc(it.piece.name)}</span>
          ${it.hasOrigin ? '' : '<span class="muted">no origin</span>'}</div>`)
      .join('');
    $('#leftPanel').innerHTML = `
      <div class="section-title">Stack</div>
      <div class="asm-list">${rows || '<p class="note">No pieces with an outline yet.</p>'}</div>
      <p class="note" style="margin-top:10px">Tick the pieces to stack. They line up by their origin points; a piece without one is centred on the others.</p>`;
  }

  // Shared-hole results, one line per pair of pieces.
  function pairLines(asm) {
    const map = new Map();
    asm.check.pairs.forEach((p) => {
      const [x, y] = p.a.index < p.b.index ? [p.a, p.b] : [p.b, p.a];
      const key = `${x.piece.id}|${y.piece.id}`;
      const cur = map.get(key) || { x, y, matched: 0, missed: 0 };
      cur.matched += p.matched;
      cur.missed += p.missed;
      map.set(key, cur);
    });
    return [...map.values()];
  }

  function renderAssemblyRight() {
    const asm = AS.buildAssembly(project);
    const it = asm.items.find((x) => x.piece.id === ui.asmSel);
    const pairs = pairLines(asm);
    const check = pairs.length
      ? pairs.map((p) => `<div class="asm-pair"><span>${esc(p.x.piece.name)} + ${esc(p.y.piece.name)}</span><span>${p.missed ? `<span class="bad">${p.missed} off</span> · ` : ''}<span class="good">${p.matched} line up</span></span></div>`).join('')
      : '<p class="note">No pieces overlap with holes yet.</p>';
    const checkCard = `<div class="card"><h4>${icon('check')} Shared holes</h4>${check}
      <p class="note">Where one piece’s holes sit on another piece, the stitch goes through both, so both need a hole there. Ones that don’t match are circled in red.</p></div>`;
    const dl = `<button class="small" id="asmDownload">${icon('laser')} Download picture (SVG)</button>`;
    if (!it) {
      $('#rightPanel').innerHTML = `${head('piece', 'Assemble', `${asm.shown.length} of ${asm.items.length} pieces stacked`)}
        <div class="tip">${icon('info')}<div>Click a piece to move, turn or flip it. Go back to <b>Edit</b> to change a piece; the stack updates.</div></div>
        ${checkCard}${dl}`;
      return;
    }
    const e = asmEntry(it.piece.id);
    $('#rightPanel').innerHTML = `${head('piece', it.piece.name, it.hasOrigin ? 'Lined up by its origin point' : 'No origin point: centred')}
      <div class="card"><h4>Turn</h4><div class="row">
        <button class="small" data-asm-rot="90">↺ 90°</button><button class="small" data-asm-rot="-90">↻ 90°</button>
        <button class="small ${e.flip ? 'primary' : ''}" id="asmFlip">${e.flip ? 'Turned over' : 'Turn over'}</button></div>
        <p class="note">Turn over flips it left to right, for a piece that sits face down.</p></div>
      <div class="card"><h4>Shift from the origin</h4><div class="grid2">
        <label class="fld"><span>Across</span>${numInput('id="asmDx"', Number(e.dx) || 0)}</label>
        <label class="fld"><span>Up</span>${numInput('id="asmDy"', Number(e.dy) || 0)}</label></div>
        <button class="small" id="asmReset" style="margin-top:8px">Line up by origin again</button></div>
      ${checkCard}
      <div class="row"><button class="small" id="asmEdit">${icon('pen')} Edit this piece</button>${dl}</div>`;
  }

  function downloadAssembly() {
    const asm = AS.buildAssembly(project);
    const b = asmBBox(asm);
    if (!b) return toast('Tick at least one piece first.');
    const pad = 10;
    const x = b.minX - pad;
    const y = -b.maxY - pad;
    const w = b.maxX - b.minX + 2 * pad;
    const hgt = b.maxY - b.minY + 2 * pad;
    const legend = asm.shown.map((it, i) => `<text x="${num(x + 2)}" y="${num(y + hgt + 6 + i * 5)}" font-size="4" font-family="sans-serif" fill="${it.color}">■ ${esc(it.piece.name)}</text>`).join('');
    const body = assemblySvg(asm, { px: (n) => n / 3.78 }).replace(/ vector-effect="non-scaling-stroke"/g, '').replace(/stroke-width="([\d.]+)"/g, (m, v) => `stroke-width="${num(Number(v) * 0.25)}"`);
    const H = hgt + 8 + asm.shown.length * 5;
    const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}mm" height="${num(H)}mm" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(H)}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(H)}" fill="#fff"/>${body}${legend}</svg>`;
    S.download(`${S.safeFilename(project.name)}-assembly.svg`, svgText, 'image/svg+xml');
    toast('Assembly picture downloaded.');
  }

  $('#leftPanel').addEventListener('click', (e) => {
    const row = ui.mode === 'assemble' && !e.target.closest('input') ? e.target.closest('[data-asm-pick]') : null;
    if (!row) return;
    ui.asmSel = ui.asmSel === row.dataset.asmPick ? null : row.dataset.asmPick;
    renderAll();
  });

  $('#rightPanel').addEventListener('click', (e) => {
    if (ui.mode !== 'assemble') return;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'asmDownload') {
      downloadAssembly();
      return;
    }
    const id = ui.asmSel;
    if (!id) return;
    const en = asmEntry(id, true);
    if (t.dataset.asmRot) {
      en.rot = ((((Number(en.rot) || 0) + Number(t.dataset.asmRot)) % 360) + 360) % 360;
      commit();
    } else if (t.id === 'asmFlip') {
      en.flip = !en.flip;
      commit();
    } else if (t.id === 'asmReset') {
      en.dx = 0;
      en.dy = 0;
      commit();
    } else if (t.id === 'asmEdit') {
      const i = project.pieces.findIndex((x) => x.id === id);
      setMode('edit');
      if (i >= 0) selectPiece(i, false);
      renderAll();
    }
  });

  $('#rightPanel').addEventListener('change', (e) => {
    if (ui.mode !== 'assemble' || !ui.asmSel) return;
    const t = e.target;
    if (t.id !== 'asmDx' && t.id !== 'asmDy') return;
    const v = M.parseLength(t.value, units());
    if (!Number.isFinite(v)) {
      bad(t);
      return;
    }
    asmEntry(ui.asmSel, true)[t.id === 'asmDx' ? 'dx' : 'dy'] = v;
    commit();
  });

  $('#leftPanel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.asmOn) {
      asmEntry(t.dataset.asmOn, true).on = t.checked;
      commit();
    }
  });

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
    $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    document.body.classList.toggle('assemble', ui.mode === 'assemble');
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
    if (ui.mode === 'assemble') {
      renderAssemblyLeft();
      renderAssemblyRight();
      renderCanvas();
      return;
    }
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
  $$('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode))
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
    if (ui.mode === 'assemble' && !mod) {
      if (e.key === 'Escape') {
        ui.asmSel = null;
        renderAll();
      }
      return;
    }
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
      else if (ui.trim) {
        ui.trim = null;
        ui.tool = 'select';
      } else if (ui.tool === 'line' && ui.linePick) {
        // No part picked: the line is dropped.
        const pc = piece();
        pc.lines = (pc.lines || []).filter((l) => l.id !== ui.linePick);
        ui.linePick = null;
        commit();
        return;
      } else if (ui.tool === 'line' && ui.lineStart) ui.lineStart = null;
      else if (ui.tool !== 'select') ui.tool = 'select';
      else clearSel();
      renderAll();
      return;
    }
    if (ui.trim && e.key === 'Enter') {
      applyTrim();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'v') setTool('select');
    else if (k === 'p') startDraw();
    else if (k === 'l') setTool('line');
    else if (k === 't') setTool('trim');
    else if (k === 'r') setTool('round');
    else if (k === 'o') setTool('origin');
    else if ((k === 'delete' || k === 'backspace') && ['shape', 'notch', 'line'].includes(ui.sel.type)) deleteSelected();
    else if ((ui.sel.type === 'edge' || ui.sel.type === 'line') && (k === 'h' || k === 's' || k === 'n')) {
      setModes(ui.sel.type === 'line' ? selected('line').map((id) => `l:${id}`) : selected('edge'), { h: 'holes', s: 'stitch', n: 'none' }[k]);
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
