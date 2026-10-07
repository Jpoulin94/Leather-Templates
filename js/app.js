// User interface: canvas editor, selection, inspector, saving and export.
(function () {
  'use strict';
  const { model: M, geom: G, layout: Lay, render: R, pdf: P, storage: S } = window.LT;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = R.escapeXml;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const vName = (i) => (i < 26 ? LETTERS[i] : LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26]);
  const MODE_LABEL = { holes: 'Holes', stitch: 'Stitch line', none: 'None' };

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
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    laser: '<path d="M12 3v7M8 6l4 4 4-4"/><rect x="4" y="14" width="16" height="6" rx="1"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
  };
  const icon = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  let project = S.loadCurrent() || M.newProject();
  const ui = {
    pieceIdx: 0,
    contour: { kind: 'outline', idx: 0 }, // the shape the inspector and selection refer to
    sel: { type: null, items: [] }, // type: 'edge' | 'corner' | 'shape' | null
    tool: 'select', // 'select' | 'draw' | 'zero'
    snap: true,
    view: null,
    mouse: null,
    shift: false,
    ptr: null,
    dirty: false,
    savedName: null,
    paper: 'letter',
    combine: null, // { idx, pieces } while choosing lines
    alignTarget: 'outline',
    advOpen: false,
  };

  // ---------------------------------------------------------------------
  // Accessors

  const piece = () => project.pieces[ui.pieceIdx];
  function contour() {
    const p = piece();
    if (ui.contour.kind === 'cutout' && p.cutouts[ui.contour.idx]) return p.cutouts[ui.contour.idx];
    ui.contour = { kind: 'outline', idx: 0 };
    return p.outline;
  }
  const units = () => project.units;
  const fmt = (mm) => M.format(mm, units());
  const edgeProps = (c, src) => (src < c.segments.length ? c.segments[src] : c.closing);
  const minorStep = () => (units() === 'in' ? 25.4 / 16 : 1);
  const contourBox = (c) => G.bbox(G.buildPrimitives(c));
  const round = (v) => Math.round(v * 10000) / 10000;
  const flip = (p) => ({ x: p.x, y: -p.y });
  const num = (v) => Number(v.toFixed(4));
  const isOutline = () => ui.contour.kind === 'outline';

  function moveContour(c, dx, dy) {
    if (c.start) c.start = { x: round(c.start.x + dx), y: round(c.start.y + dy) };
  }

  function numInput(attrs, mm) {
    return `<span class="num" data-unit="${units()}"><input type="text" inputmode="decimal" ${attrs} value="${mm === '' ? '' : fmt(mm)}"></span>`;
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
    const c = contour();
    if (ui.sel.type === 'edge' || ui.sel.type === 'corner') {
      const ids = new Set(G.buildEdges(c).map((e) => e.edge));
      ui.sel.items = ui.sel.items.filter((i) => ids.has(i));
      if (!ui.sel.items.length) ui.sel = { type: null, items: [] };
    }
    if (ui.sel.type === 'shape' && isOutline()) ui.sel = { type: null, items: [] };
  }

  function restore(snapshot) {
    project = JSON.parse(snapshot);
    history.last = snapshot;
    ui.pieceIdx = Math.min(ui.pieceIdx, project.pieces.length - 1);
    contour();
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

  const inch = () => units() === 'in';

  function pieceCenter() {
    const b = Lay.pieceBBox(Lay.layoutPiece(project, piece()));
    return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
  }

  async function addPiece(kind) {
    if (kind === 'draw') {
      project.pieces.push(M.newPiece(`Piece ${project.pieces.length + 1}`, M.newContour()));
      selectPiece(project.pieces.length - 1, false);
      startDraw();
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
        { key: 'r', label: 'Corner radius', value: 0 },
      ], 'Add piece');
      if (!v) return;
      outline = M.rectangle(v.w, v.h, v.r, 0, 0, 'holes');
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
        { key: 'r', label: 'Corner radius', value: 0 },
      ], 'Add');
      if (!v) return;
      shape = M.rectangle(v.w, v.h, v.r, c.x - v.w / 2, c.y - v.h / 2, 'none');
    }
    piece().cutouts.push(shape);
    selectShape(piece().cutouts.length - 1);
    commit();
  }

  function selectPiece(i, doCommit = true) {
    ui.pieceIdx = Math.max(0, Math.min(project.pieces.length - 1, i));
    ui.contour = { kind: 'outline', idx: 0 };
    ui.sel = { type: null, items: [] };
    ui.combine = null;
    if (ui.tool === 'draw') ui.tool = 'select';
    ui.view = null;
    if (doCommit) commit();
  }

  function selectShape(idx) {
    ui.contour = { kind: 'cutout', idx };
    ui.sel = { type: 'shape', items: [] };
  }

  function clearSel() {
    ui.contour = { kind: 'outline', idx: 0 };
    ui.sel = { type: null, items: [] };
  }

  // ---------------------------------------------------------------------
  // Drawing. Draw makes the outline when the piece has none, otherwise a
  // new shape.

  function startDraw(target) {
    const pc = piece();
    if (target === 'outline' || !pc.outline.segments.length) {
      ui.contour = { kind: 'outline', idx: 0 };
    } else if (target !== 'current') {
      pc.cutouts.push(M.newContour());
      ui.contour = { kind: 'cutout', idx: pc.cutouts.length - 1 };
    }
    const c = contour();
    c.start = null;
    c.segments = [];
    c.closing = { mode: isOutline() ? 'holes' : 'none', fillet: 0, corner: true };
    ui.sel = { type: null, items: [] };
    ui.tool = 'draw';
    commit();
  }

  function finishDraw() {
    const c = contour();
    ui.tool = 'select';
    if (c.segments.length < 2) {
      if (!isOutline()) {
        piece().cutouts.splice(ui.contour.idx, 1);
        clearSel();
      }
      toast('A shape needs at least two lines.');
    } else if (!isOutline()) {
      ui.sel = { type: 'shape', items: [] };
    }
    commit();
  }

  function snapPoint(pt) {
    const c = contour();
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
    const c = contour();
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
    const mode = isOutline() ? 'holes' : 'none';
    c.segments.push(M.seg('line', { length: round(L), angle: round(((G.deg(Math.atan2(d.y, d.x)) % 360) + 360) % 360), mode }));
    commit();
  }

  // ---------------------------------------------------------------------
  // Selection-driven edits

  function selectedEdges() {
    return ui.sel.type === 'edge' ? ui.sel.items : [];
  }
  function selectedCorners() {
    return ui.sel.type === 'corner' ? ui.sel.items : [];
  }

  // Corners that can be rounded: both neighbouring edges are straight.
  function roundable(c, src) {
    const edges = G.buildEdges(c);
    const i = edges.findIndex((e) => e.edge === src);
    if (i < 0 || edges.length < 2) return false;
    const prev = edges[(i - 1 + edges.length) % edges.length];
    return prev.type === 'line' && edges[i].type === 'line';
  }

  function setModes(c, srcs, mode) {
    srcs.forEach((s) => {
      edgeProps(c, s).mode = mode;
    });
  }

  function setFillets(c, srcs, r) {
    srcs.filter((s) => roundable(c, s)).forEach((s) => {
      edgeProps(c, s).fillet = r;
    });
  }

  const allEdgeIds = (c) => G.buildEdges(c).map((e) => e.edge);

  // ---------------------------------------------------------------------
  // Canvas

  const svg = $('#canvas');

  function fitView() {
    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 600;
    let b = Lay.pieceBBox(Lay.layoutPiece(project, piece()));
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
    const lay = Lay.layoutPiece(project, pc);
    const active = contour();
    const combining = ui.combine;
    const contours = [
      { c: pc.outline, lay: lay.outline, kind: 'outline', idx: 0 },
      ...pc.cutouts.map((c, i) => ({ c, lay: lay.cutouts[i], kind: 'cutout', idx: i })),
    ];
    const selEdges = new Set(selectedEdges());

    // Piece fill
    if (lay.outline.prims.length && !combining) {
      out.push(`<path d="${R.pathData(lay.outline.prims, flip, true)}" fill="color-mix(in srgb, var(--accent) 5%, transparent)" stroke="none"/>`);
    }

    contours.forEach(({ c, lay: cl, kind, idx }) => {
      if (combining && (kind === 'outline' || idx === combining.idx)) return;
      const isActive = c === active;
      if (kind === 'cutout' && !combining && ui.tool === 'select') {
        const selected = isActive && ui.sel.type === 'shape';
        out.push(`<path class="grab" d="${R.pathData(cl.prims, flip, true)}" fill="${selected ? 'color-mix(in srgb, var(--accent) 14%, var(--canvas))' : 'var(--canvas)'}" stroke="none" data-kind="cutout" data-ci="${idx}" data-shape="1"/>`);
      }
      // Selection glow under selected edges
      if (isActive) {
        cl.prims.forEach((p) => {
          if (p.edge !== undefined && selEdges.has(p.edge)) {
            out.push(`<path d="${R.pathData([p], flip, false)}" fill="none" stroke="color-mix(in srgb, var(--accent) 35%, transparent)" stroke-width="10" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
          }
        });
      }
      if (isActive && ui.sel.type === 'shape') {
        out.push(`<path d="${R.pathData(cl.prims, flip, true)}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-opacity="0.3" vector-effect="non-scaling-stroke"/>`);
      }
      cl.prims.forEach((p) => {
        out.push(`<path d="${R.pathData([p], flip, false)}" fill="none" stroke="var(--edge-${p.mode === 'holes' ? 'none' : p.mode})" stroke-width="${isActive ? 2 : 1.5}" vector-effect="non-scaling-stroke"/>`);
      });
      cl.stitch.forEach((st) => {
        out.push(`<path d="${R.pathData(st.prims, flip, st.closed)}" fill="none" stroke="var(--edge-stitch)" stroke-width="1.4" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>`);
      });
      cl.holes.forEach((hp) => {
        out.push(`<circle cx="${num(hp.x)}" cy="${num(-hp.y)}" r="${num(lay.holeRadius)}" fill="color-mix(in srgb, var(--edge-holes) 16%, var(--canvas))" stroke="var(--edge-holes)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      });
      if (!combining && ui.tool !== 'draw') {
        cl.prims.forEach((p) => {
          if (p.fillet !== undefined) return;
          out.push(`<path class="hit" d="${R.pathData([p], flip, false)}" fill="none" stroke="transparent" stroke-width="14" stroke-linecap="round" vector-effect="non-scaling-stroke" data-kind="${kind}" data-ci="${idx}" data-edge="${p.edge}"/>`);
        });
      }
    });

    // Corner dots: on the outline, and on the selected shape.
    if (!combining && ui.tool === 'select') {
      const selCorners = new Set(selectedCorners());
      contours.forEach(({ c, kind, idx }) => {
        const isActive = c === active;
        if (kind === 'cutout' && !isActive) return;
        G.buildEdges(c).forEach((e) => {
          const v = G.primStart(e);
          const vp = G.vertexProps(c, e.edge);
          const sel = isActive && selCorners.has(e.edge);
          const r = sel ? 6 : 4.5;
          const fill = sel ? 'var(--accent)' : vp.corner ? 'var(--panel)' : 'var(--panel)';
          out.push(`<circle class="vtx" cx="${num(v.x)}" cy="${num(-v.y)}" r="${num(px(r))}" fill="${fill}" stroke="var(--accent)" stroke-width="${sel ? 2 : 1.5}" ${vp.corner ? '' : 'stroke-dasharray="2 2"'} vector-effect="non-scaling-stroke" data-kind="${kind}" data-ci="${idx}" data-vertex="${e.edge}"><title>Corner ${vName(e.edge)}${vp.fillet ? `, rounded ${fmt(vp.fillet)} ${units()}` : ''}${vp.corner ? '' : ', no corner hole'}</title></circle>`);
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

    // Zero point
    if (pc.zero.enabled) {
      const z = G.pointOnEdge(pc.outline, pc.zero.edge, pc.zero.offset);
      if (z) {
        const r = px(7);
        out.push(`<g stroke="var(--zero)" stroke-width="2" fill="none" pointer-events="none">
          <circle cx="${num(z.x)}" cy="${num(-z.y)}" r="${num(r)}" vector-effect="non-scaling-stroke"/>
          <path d="M${num(z.x - r * 1.6)} ${num(-z.y)}H${num(z.x + r * 1.6)}M${num(z.x)} ${num(-z.y - r * 1.6)}V${num(-z.y + r * 1.6)}" vector-effect="non-scaling-stroke"/></g>`);
      }
    }

    // Drawing preview
    if (ui.tool === 'draw') {
      const c = active;
      if (c.start) {
        let end = c.start;
        G.buildEdges(c).filter((e) => !e.closing).forEach((e) => {
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
    const c = contour();
    let msg = '';
    if (ui.tool === 'draw') {
      msg = !c.start
        ? 'Click to place the first point.'
        : 'Click to add points · Shift for 15° steps · click the first point or press Enter to finish · Backspace removes the last line';
    } else if (ui.combine) {
      msg = 'Click lines to keep (solid) or remove (dashed), then Apply.';
    } else if (ui.tool === 'zero') {
      msg = 'Click a spot on the outline to place the zero point.';
    } else if (ui.sel.type === 'edge' || ui.sel.type === 'corner') {
      msg = 'Shift-click to select more · Esc to deselect';
    } else if (ui.sel.type === 'shape') {
      msg = 'Drag to move · Delete to remove';
    } else {
      msg = 'Click an edge or corner to change it · Shift-click to pick several · drag to pan, scroll to zoom';
    }
    $('#hint').textContent = msg;
  }

  function renderZoom() {
    const pct = $('#zoomPct');
    // 100% = true size on a 96 dpi screen.
    if (pct && ui.view) pct.textContent = `${Math.round((ui.view.scale / (96 / 25.4)) * 100)}%`;
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
    const el = target && target.closest ? target.closest('[data-edge],[data-vertex],[data-shape]') : null;
    if (ui.tool === 'zero') {
      if (!el || el.dataset.kind !== 'outline' || el.dataset.edge === undefined) {
        toast('Click an edge of the outline.');
        return;
      }
      const src = Number(el.dataset.edge);
      const e = G.buildEdges(piece().outline).find((x) => x.edge === src);
      piece().zero = { enabled: true, edge: src, offset: round(G.projectOnPrim(e, world)) };
      ui.tool = 'select';
      commit();
      return;
    }
    if (!el) {
      clearSel();
      renderAll();
      return;
    }
    const kind = el.dataset.kind;
    const idx = Number(el.dataset.ci);
    if (el.dataset.shape) {
      selectShape(idx);
      renderAll();
      return;
    }
    const type = el.dataset.vertex !== undefined ? 'corner' : 'edge';
    const src = Number(type === 'corner' ? el.dataset.vertex : el.dataset.edge);
    const same = ui.contour.kind === kind && (kind === 'outline' || ui.contour.idx === idx) && ui.sel.type === type;
    ui.contour = { kind, idx: kind === 'outline' ? 0 : idx };
    if (shiftKey && same) {
      const items = new Set(ui.sel.items);
      if (items.has(src)) items.delete(src);
      else items.add(src);
      ui.sel = items.size ? { type, items: [...items] } : { type: null, items: [] };
    } else {
      ui.sel = { type, items: [src] };
    }
    renderAll();
  }

  svg.addEventListener('pointerdown', (e) => {
    ui.ptr = { x: e.clientX, y: e.clientY, cx: ui.view.cx, cy: ui.view.cy, moved: false, target: e.target, button: e.button, shift: e.shiftKey };
    const grab = e.button === 0 && ui.tool === 'select' && !ui.combine && e.target.closest
      ? e.target.closest('[data-shape]')
      : null;
    if (grab) {
      const idx = Number(grab.dataset.ci);
      const c = piece().cutouts[idx];
      if (c && c.start) ui.ptr.drag = { idx, start: { ...c.start } };
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
        const c = piece().cutouts[ui.ptr.drag.idx];
        let mx = dx / ui.view.scale;
        let my = -dy / ui.view.scale;
        if (ui.snap) {
          const st = minorStep();
          mx = Math.round(mx / st) * st;
          my = Math.round(my / st) * st;
        }
        c.start = { x: round(ui.ptr.drag.start.x + mx), y: round(ui.ptr.drag.start.y + my) };
        selectShape(ui.ptr.drag.idx);
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

  function renderRail() {
    const btn = (attrs, ic, tip, on) => `<button class="icon-btn ${on ? 'on' : ''}" ${attrs} data-tip="${tip}" aria-label="${tip}">${icon(ic)}</button>`;
    $('#rail').innerHTML = [
      btn('data-tool="select"', 'select', 'Select (V)', ui.tool === 'select' && !ui.combine),
      btn('data-tool="draw"', 'pen', piece().outline.segments.length ? 'Draw a shape (P)' : 'Draw the outline (P)', ui.tool === 'draw'),
      '<hr>',
      btn('data-add="rect"', 'rect', 'Add a rectangle', false),
      btn('data-add="circle"', 'circle', 'Add a circle', false),
      '<hr>',
      btn('data-tool="zero"', 'target', 'Place zero point', ui.tool === 'zero'),
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
    if (b.dataset.tool) {
      const tool = b.dataset.tool;
      if (ui.combine) ui.combine = null;
      if (tool === 'draw') {
        if (ui.tool !== 'draw') startDraw();
        return;
      }
      if (ui.tool === 'draw') finishDraw();
      ui.tool = tool;
      renderAll();
    } else if (b.dataset.add) {
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
  // Left sidebar: pieces and stitching settings

  function thumb(pc) {
    const prims = G.buildPrimitives(pc.outline);
    const b = G.bbox(prims);
    if (!b) return '';
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxY - b.minY, 1);
    const pad = Math.max(w, h) * 0.08;
    const holes = pc.cutouts.map((c) => R.pathData(G.buildPrimitives(c), flip, true)).join('');
    return `<svg viewBox="${num(b.minX - pad)} ${num(-b.maxY - pad)} ${num(w + 2 * pad)} ${num(h + 2 * pad)}" preserveAspectRatio="xMidYMid meet"><path d="${R.pathData(prims, flip, true)}${holes}" fill-rule="evenodd" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function sizeText(c) {
    const b = contourBox(c);
    return b ? `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} ${units()}` : 'Empty';
  }

  function settingsFields(obj, prefix) {
    return [
      ['holeDiameter', 'Hole size', 'Diameter of your round punch'],
      ['spacing', 'Spacing', 'Centre to centre of neighbouring holes'],
      ['edgeDistance', 'From edge', 'Gap between the hole and the leather edge'],
      ['stitchOffset', 'Stitch line', 'Distance of the stitch line from the edge'],
    ]
      .map(([k, label, tip]) => `<label class="fld" title="${tip}"><span>${label}</span>${numInput(`data-set="${prefix}" data-key="${k}"`, obj[k])}</label>`)
      .join('');
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
      <div class="section-title">Stitching</div>
      <div class="card"><div class="grid2">${settingsFields(project.defaults, 'd_')}</div>
        <p class="note">Used by every piece unless a piece has its own.</p></div>`;
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
    if (t.dataset.piece !== undefined) selectPiece(Number(t.dataset.piece));
  });

  function parseInto(t, assign) {
    const v = M.parseLength(t.value, units());
    if (!Number.isFinite(v) || v < 0) {
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
    return list.length && list.every((v) => v === list[0]) ? list[0] : null;
  }

  const RADIUS_CHIPS = { mm: [0, 2, 3, 5, 10], in: [0, 1 / 16, 1 / 8, 1 / 4, 1 / 2] };
  const chipLabel = (v) => (inch() ? ({ 0: '0', 0.0625: '1/16', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[v] : String(v));

  function radiusControl(value, scope) {
    const max = inch() ? 50.8 : 50;
    const step = inch() ? 25.4 / 32 : 0.5;
    const chips = RADIUS_CHIPS[units()]
      .map((v) => {
        const mm = inch() ? v * 25.4 : v;
        const on = value !== null && Math.abs(value - mm) < 1e-6;
        return `<button class="${on ? 'on' : ''}" data-radius="${mm}" data-scope="${scope}">${chipLabel(v)}${v && !inch() ? '' : ''}</button>`;
      })
      .join('');
    return `<div class="slider-row">
        <input type="range" min="0" max="${max}" step="${step}" value="${value === null ? 0 : Math.min(value, max)}" data-radius-slider="${scope}" aria-label="Corner radius">
        ${numInput(`data-radius-input="${scope}" placeholder="mixed"`, value === null ? '' : value)}
      </div>
      <div class="chips">${chips}<span class="muted" style="font-size:12px;align-self:center">${units()}</span></div>`;
  }

  function spacingCheck(cl) {
    if (!cl) return '';
    const adjusted = cl.sections.filter((s) => s.actual && Math.abs(s.actual - s.requested) > 0.005);
    const n = cl.holes.length;
    if (!n) return '';
    return `<div class="card"><h4>${icon('check')} ${n} hole${n === 1 ? '' : 's'}</h4>${
      adjusted.length
        ? adjusted.map((s) => `<div class="warn">A ${fmt(s.length)} ${units()} run is spaced ${fmt(s.actual)} ${units()} (you set ${fmt(s.requested)}) so holes land on the corners.</div>`).join('')
        : '<div class="ok">Every run uses your exact spacing.</div>'
    }</div>`;
  }

  function advancedSection(c) {
    const n = c.segments.length;
    const closing = G.closingEdge(c);
    const inp = (i, key, val, isLen = true) =>
      `<input type="text" inputmode="decimal" data-seg="${i}" data-key="${key}" value="${isLen ? fmt(val) : num(Number(val) || 0)}">`;
    const selE = new Set(selectedEdges());
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

  function renderPieceInspector() {
    const pc = piece();
    const c = pc.outline;
    const ids = allEdgeIds(c);
    const lay = Lay.layoutPiece(project, pc);
    const modes = ids.map((s) => edgeProps(c, s).mode || 'none');
    const roundIds = ids.filter((s) => roundable(c, s));
    const fil = commonValue(roundIds.map((s) => Number(edgeProps(c, s).fillet) || 0));
    const corners = ids.map((s) => edgeProps(c, s).corner !== false);
    const eff = Lay.pieceSettings(project, pc);
    const outlineEdges = G.buildEdges(c);
    const zeroEdge = outlineEdges.find((e) => e.edge === pc.zero.edge);
    if (!c.segments.length) {
      return `${head('piece', pc.name, 'No outline yet', true)}
        <div class="tip">${icon('info')}<div>Pick <b>Draw</b> in the tool bar and click points on the grid, or start from a shape.</div></div>
        <button class="primary block" data-tool-start="draw">${icon('pen')} Draw the outline</button>`;
    }
    return `${head('piece', pc.name, sizeText(c), true)}
      <div class="tip">${icon('info')}<div>Click any edge or corner on the drawing to change just that one. Shift-click to pick several.</div></div>
      <div class="card"><h4>${icon('edge')} All edges</h4>${modeSeg(commonValue(modes), 'data-allmode')}</div>
      ${roundIds.length ? `<div class="card"><h4>${icon('corner')} Round all corners</h4>${radiusControl(fil, 'all')}</div>` : ''}
      ${ids.length > 1 ? `<div class="card"><label class="switch"><span>Hole on every corner</span><input type="checkbox" id="allCorners" ${corners.every(Boolean) ? 'checked' : ''}></label>
        <p class="note">Spacing adjusts slightly so a hole lands exactly on each corner.</p></div>` : ''}
      ${spacingCheck(lay.outline)}
      <div class="card"><label class="switch"><span>Zero point</span><input type="checkbox" id="zeroOn" ${pc.zero.enabled ? 'checked' : ''}></label>
        ${pc.zero.enabled ? `<div class="grid2" style="margin-top:8px">
            <label class="fld"><span>On edge</span><select id="zeroEdge">${outlineEdges.map((e) => `<option value="${e.edge}" ${e.edge === pc.zero.edge ? 'selected' : ''}>Edge ${e.edge + 1}</option>`).join('')}</select></label>
            <label class="fld"><span>From its start${zeroEdge ? ` (of ${fmt(G.primLength(zeroEdge))})` : ''}</span>${numInput('id="zeroOffset"', pc.zero.offset)}</label></div>
          <div class="row" style="margin-top:8px"><button class="small" data-tool-start="zero">${icon('target')} Pick on drawing</button></div>` : ''}
        <p class="note">A hole always lands on the zero point, so pieces that share one line up when stacked.</p></div>
      <div class="card"><label class="switch"><span>Own stitching sizes for this piece</span><input type="checkbox" id="customSettings" ${pc.customSettings ? 'checked' : ''}></label>
        ${pc.customSettings ? `<div class="grid2" style="margin-top:8px">${settingsFields(eff, 'p_')}</div>` : ''}</div>
      ${advancedSection(c)}`;
  }

  function renderEdgeInspector() {
    const c = contour();
    const items = selectedEdges();
    const modes = items.map((s) => edgeProps(c, s).mode || 'none');
    const one = items.length === 1 ? items[0] : null;
    let detail = '';
    if (one !== null) {
      const e = G.buildEdges(c).find((x) => x.edge === one);
      const s = c.segments[one];
      if (s) {
        detail = s.type === 'arc'
          ? `<div class="grid2"><label class="fld"><span>Radius</span>${numInput(`data-seg="${one}" data-key="radius"`, s.radius)}</label>
             <label class="fld"><span>Sweep °</span><input type="text" inputmode="decimal" data-seg="${one}" data-key="sweep" value="${num(Number(s.sweep))}"></label></div>`
          : `<div class="grid2"><label class="fld"><span>Length</span>${numInput(`data-seg="${one}" data-key="length"`, s.length)}</label>
             <label class="fld"><span>Angle °</span><input type="text" inputmode="decimal" data-seg="${one}" data-key="angle" value="${num(Number(s.angle))}"></label></div>`;
      } else if (e) {
        detail = `<p class="ok">Closing edge, ${fmt(G.primLength(e))} ${units()} long. It joins the last point back to the start.</p>`;
      }
    }
    const what = isOutline() ? 'the outline' : `shape ${ui.contour.idx + 1}`;
    return `${head('edge', one !== null ? `Edge ${one + 1}` : `${items.length} edges`, `On ${what}`)}
      <div class="card"><h4>Along this edge</h4>${modeSeg(commonValue(modes))}</div>
      ${detail ? `<div class="card"><h4>Size</h4>${detail}</div>` : ''}
      <div class="row"><button class="small" data-selall="edge">Select all edges</button><button class="small ghost" data-deselect="1">Done</button></div>`;
  }

  function renderCornerInspector() {
    const c = contour();
    const items = selectedCorners();
    const okIds = items.filter((s) => roundable(c, s));
    const fil = commonValue(okIds.map((s) => Number(edgeProps(c, s).fillet) || 0));
    const corner = items.map((s) => edgeProps(c, s).corner !== false);
    const all = corner.every(Boolean);
    const none = corner.every((x) => !x);
    const one = items.length === 1 ? items[0] : null;
    const what = isOutline() ? 'the outline' : `shape ${ui.contour.idx + 1}`;
    return `${head('corner', one !== null ? `Corner ${vName(one)}` : `${items.length} corners`, `On ${what}`)}
      <div class="card"><h4>Rounded</h4>${okIds.length ? radiusControl(fil, 'sel') : ''}
        ${okIds.length < items.length ? `<p class="note">${okIds.length ? 'Some of these corners' : 'This corner'} touch a curved edge, so ${okIds.length ? 'they' : 'it'} can’t be rounded.</p>` : ''}</div>
      <div class="card"><label class="switch"><span>Hole on this corner</span><input type="checkbox" id="selCorner" ${all ? 'checked' : ''} ${!all && !none ? 'data-mixed="1"' : ''}></label>
        <p class="note">Rounded corners have no single point, so holes simply follow the curve.</p></div>
      <div class="row"><button class="small" data-selall="corner">Select all corners</button><button class="small ghost" data-deselect="1">Done</button></div>`;
  }

  function renderShapeInspector() {
    const pc = piece();
    const c = contour();
    const b = contourBox(c);
    const ids = allEdgeIds(c);
    const modes = ids.map((s) => edgeProps(c, s).mode || 'none');
    const roundIds = ids.filter((s) => roundable(c, s));
    const fil = commonValue(roundIds.map((s) => Number(edgeProps(c, s).fillet) || 0));
    const lay = Lay.layoutPiece(project, pc);
    const targets = [`<option value="outline">the outline</option>`]
      .concat(pc.cutouts.map((_, i) => (i === ui.contour.idx ? '' : `<option value="cutout:${i}">shape ${i + 1}</option>`)))
      .join('');
    const al = (k, label) => `<button data-align="${k}">${label}</button>`;
    return `${head('shape', `Shape ${ui.contour.idx + 1}`, b ? `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} ${units()} · cut out of the piece` : '')}
      ${b ? `<div class="card"><h4>Position</h4><div class="grid2">
          <label class="fld"><span>Centre X</span>${numInput('id="posX"', (b.minX + b.maxX) / 2)}</label>
          <label class="fld"><span>Centre Y</span>${numInput('id="posY"', (b.minY + b.maxY) / 2)}</label></div>
        <div class="align-label">Line up with <select id="alignTarget" style="padding:2px 4px">${targets}</select></div>
        <div class="align-grid">${al('left', 'Left')}${al('hcenter', 'Centre')}${al('right', 'Right')}${al('top', 'Top')}${al('vmiddle', 'Middle')}${al('bottom', 'Bottom')}</div>
        <div class="align-label">Centre on its edge</div>
        <div class="align-grid four">${al('onTop', 'Top')}${al('onBottom', 'Bottom')}${al('onLeft', 'Left')}${al('onRight', 'Right')}</div>
        <p class="note">Or drag the shape on the drawing.</p></div>` : ''}
      <div class="card"><h4>Combine with the outline</h4>
        <div class="combine-grid">
          <button data-combine="cut" title="Remove this shape's area from the outline">Cut away</button>
          <button data-combine="merge" title="Add this shape's area to the outline">Merge</button>
          <button data-combine="overlap" title="Keep only where they overlap">Keep overlap</button>
          <button id="chooseLines" title="Pick which lines to keep">Choose lines…</button>
        </div>
        <p class="note">Thumb notch: centre a circle on the top edge, then Cut away.</p></div>
      <div class="card"><h4>${icon('edge')} Around this shape</h4>${modeSeg(commonValue(modes), 'data-allmode')}</div>
      ${roundIds.length ? `<div class="card"><h4>${icon('corner')} Round all corners</h4>${radiusControl(fil, 'all')}</div>` : ''}
      ${spacingCheck(lay.cutouts[ui.contour.idx])}
      ${advancedSection(c)}
      <button class="small danger" id="delShape">${icon('trash')} Delete shape</button>`;
  }

  function renderDrawInspector() {
    const c = contour();
    return `${head('pen', isOutline() ? 'Drawing the outline' : 'Drawing a shape', `${c.segments.length} line${c.segments.length === 1 ? '' : 's'} so far`)}
      <div class="tip">${icon('info')}<div>Click on the grid to place points. Click the first point (or press Enter) to close the shape. Hold Shift for straight 15° steps. You can fine-tune sizes afterwards.</div></div>
      <div class="row"><button class="primary" id="finishDraw">${icon('check')} Finish</button><button id="undoPoint" ${c.start ? '' : 'disabled'}>Remove last point</button></div>`;
  }

  function renderCombineInspector() {
    const kept = ui.combine.pieces.filter((x) => x.keep).length;
    return `${head('shape', 'Choose lines', `${kept} of ${ui.combine.pieces.length} kept`)}
      <div class="tip">${icon('info')}<div>The outline and shape ${ui.combine.idx + 1} are split wherever they cross. Click a line to keep it (solid) or remove it (dashed). The kept lines must join into one closed shape.</div></div>
      <div class="card"><h4>Start from</h4><div class="seg wide">
        <button data-preset="cut">Cut away</button><button data-preset="merge">Merge</button><button data-preset="overlap">Overlap</button></div></div>
      <div class="row"><button class="primary" id="applyLines">Apply</button><button class="ghost" id="cancelLines">Cancel</button></div>`;
  }

  function renderRight() {
    validateSel();
    let html;
    if (ui.tool === 'draw') html = renderDrawInspector();
    else if (ui.combine) html = renderCombineInspector();
    else if (ui.sel.type === 'edge') html = renderEdgeInspector();
    else if (ui.sel.type === 'corner') html = renderCornerInspector();
    else if (ui.sel.type === 'shape' && !isOutline()) html = renderShapeInspector();
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

  // Ids the radius control applies to.
  function radiusTargets(scope) {
    const c = contour();
    return scope === 'sel' ? selectedCorners() : allEdgeIds(c);
  }

  $('#rightPanel').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.radiusSlider) {
      // Live preview while dragging; the change event records it for undo.
      setFillets(contour(), radiusTargets(t.dataset.radiusSlider), Number(t.value));
      const box = $(`[data-radius-input="${t.dataset.radiusSlider}"]`);
      if (box) box.value = fmt(Number(t.value));
      renderCanvas();
    }
  });

  $('#rightPanel').addEventListener('change', (e) => {
    const t = e.target;
    const c = contour();
    const pc = piece();
    if (t.dataset.radiusSlider) {
      setFillets(c, radiusTargets(t.dataset.radiusSlider), Number(t.value));
      return commit();
    }
    if (t.dataset.radiusInput) return parseInto(t, (v) => setFillets(c, radiusTargets(t.dataset.radiusInput), v));
    if (t.id === 'pieceName') {
      pc.name = t.value.trim() || pc.name;
      return commit();
    }
    if (t.id === 'allCorners') {
      allEdgeIds(c).forEach((s) => (edgeProps(c, s).corner = t.checked));
      return commit();
    }
    if (t.id === 'selCorner') {
      selectedCorners().forEach((s) => (edgeProps(c, s).corner = t.checked));
      return commit();
    }
    if (t.dataset.set === 'p_') return parseInto(t, (v) => (pc.settings[t.dataset.key] = v));
    if (t.id === 'customSettings') {
      if (t.checked && !Object.keys(pc.settings).length) pc.settings = { ...project.defaults };
      pc.customSettings = t.checked;
      return commit();
    }
    if (t.id === 'zeroOn') {
      pc.zero.enabled = t.checked;
      return commit();
    }
    if (t.id === 'zeroEdge') {
      pc.zero.edge = Number(t.value);
      pc.zero.offset = 0;
      return commit();
    }
    if (t.id === 'zeroOffset') return parseInto(t, (v) => (pc.zero.offset = v));
    if (t.id === 'alignTarget') {
      ui.alignTarget = t.value;
      return undefined;
    }
    if (t.id === 'posX' || t.id === 'posY') {
      const v = M.parseLength(t.value, units());
      const b = contourBox(c);
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
    if (t.dataset.seg !== undefined) {
      const s = c.segments[Number(t.dataset.seg)];
      const key = t.dataset.key;
      if (key === 'type') {
        if (t.value === 'arc') Object.assign(s, { type: 'arc', radius: s.radius || (s.length ? s.length / 2 : 20), sweep: s.sweep || 90 });
        else Object.assign(s, { type: 'line', length: s.length || (s.radius ? s.radius * G.rad(Math.abs(s.sweep || 90)) : 20) });
        return commit();
      }
      if (key === 'length' || key === 'radius') {
        const v = M.parseLength(t.value, units());
        if (!Number.isFinite(v) || v <= 0) return bad(t);
        s[key] = v;
      } else {
        const v = M.parseNumber(t.value);
        if (!Number.isFinite(v) || (key === 'sweep' && (v === 0 || Math.abs(v) > 360))) return bad(t);
        s[key] = v;
      }
      return commit();
    }
    return undefined;
  });

  function bad(input) {
    input.classList.add('bad');
    toast('That value isn’t valid.');
  }

  $('#rightPanel').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return undefined;
    const c = contour();
    if (t.dataset.setmode) {
      setModes(c, selectedEdges(), t.dataset.setmode);
      return commit();
    }
    if (t.dataset.allmode) {
      setModes(c, allEdgeIds(c), t.dataset.allmode);
      return commit();
    }
    if (t.dataset.radius !== undefined) {
      setFillets(c, radiusTargets(t.dataset.scope), Number(t.dataset.radius));
      return commit();
    }
    if (t.dataset.selall) {
      ui.sel = { type: t.dataset.selall, items: allEdgeIds(c) };
      return renderAll();
    }
    if (t.dataset.deselect) {
      clearSel();
      return renderAll();
    }
    if (t.dataset.toolStart) {
      if (t.dataset.toolStart === 'draw') startDraw('outline');
      else {
        ui.tool = t.dataset.toolStart;
        renderAll();
      }
      return undefined;
    }
    if (t.dataset.delSeg !== undefined) {
      c.segments.splice(Number(t.dataset.delSeg), 1);
      ui.sel = { type: null, items: [] };
      return commit();
    }
    if (t.dataset.align) return alignShape(t.dataset.align);
    if (t.dataset.combine) return applyCombine(ui.contour.idx, t.dataset.combine);
    if (t.dataset.preset && ui.combine) {
      LT.boolean.preset(ui.combine.pieces, t.dataset.preset);
      return renderAll();
    }
    switch (t.id) {
      case 'addLine':
      case 'addArc': {
        if (!c.start) c.start = { x: 0, y: 0 };
        const angle = round(G.endHeading(c));
        const mode = isOutline() ? 'holes' : 'none';
        c.segments.push(t.id === 'addLine'
          ? M.seg('line', { length: inch() ? 25.4 : 20, angle, mode })
          : M.seg('arc', { radius: inch() ? 12.7 : 15, sweep: 90, angle, mode }));
        return commit();
      }
      case 'redraw':
        return startDraw('current');
      case 'delShape':
        piece().cutouts.splice(ui.contour.idx, 1);
        clearSel();
        commit();
        return toast('Shape deleted. Undo brings it back.');
      case 'chooseLines':
        return startChooseLines(ui.contour.idx);
      case 'applyLines':
        return ui.combine && applyCombine(ui.combine.idx, null, ui.combine.pieces);
      case 'cancelLines':
        ui.combine = null;
        return renderAll();
      case 'finishDraw':
        return finishDraw();
      case 'undoPoint':
        if (c.segments.length) c.segments.pop();
        else c.start = null;
        return commit();
      default:
        return undefined;
    }
  });

  // ---------------------------------------------------------------------
  // Aligning and combining shapes

  function alignShape(how) {
    const pc = piece();
    const c = contour();
    const target = ui.alignTarget.startsWith('cutout:') ? pc.cutouts[Number(ui.alignTarget.split(':')[1])] : pc.outline;
    const S0 = contourBox(c);
    const T = target && contourBox(target);
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

  // Keep the zero point at the same spot when the outline's edges change.
  function relocateZero(pc, oldOutline) {
    if (!pc.zero.enabled) return;
    const pt = G.pointOnEdge(oldOutline, pc.zero.edge, pc.zero.offset);
    if (!pt) return;
    let best = null;
    G.buildEdges(pc.outline).forEach((e) => {
      const s = G.projectOnPrim(e, pt);
      const d = G.dist(G.primPointAt(e, s), pt);
      if (!best || d < best.d) best = { d, edge: e.edge, offset: s };
    });
    if (best) pc.zero = { ...pc.zero, edge: best.edge, offset: round(best.offset) };
  }

  function applyCombine(idx, op, pieces) {
    const pc = piece();
    const res = LT.boolean.combine(pc.outline, pc.cutouts[idx], op, pieces);
    if (!res.outline) {
      toast(pieces ? 'The kept lines don’t join into a closed shape.' : 'Those shapes don’t overlap, so there’s nothing to keep.');
      return false;
    }
    if (op === 'merge' && res.extra) {
      toast('The shape doesn’t touch the outline, so it can’t be merged.');
      return false;
    }
    const old = pc.outline;
    pc.outline = res.outline;
    pc.cutouts.splice(idx, 1);
    pc.cutouts.push(...res.holes);
    relocateZero(pc, old);
    clearSel();
    ui.combine = null;
    commit();
    const notes = [];
    if (res.extra) notes.push(`The result came apart into ${res.extra + 1} parts; the largest was kept.`);
    if (res.open) notes.push('Some kept lines didn’t connect and were left out.');
    toast(notes.length ? notes.join(' ') : 'Combined. Undo if it isn’t what you wanted.');
    return true;
  }

  function startChooseLines(idx) {
    const pc = piece();
    const A = G.buildPrimitives(pc.outline);
    const B = G.buildPrimitives(pc.cutouts[idx]);
    ui.combine = { idx, pieces: LT.boolean.preset(LT.boolean.splitShapes(A, B), 'cut') };
    ui.tool = 'select';
    renderAll();
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
        const c = contour();
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
    if (k === 'v') {
      ui.tool = 'select';
      renderAll();
    } else if (k === 'p') {
      startDraw();
    } else if ((k === 'delete' || k === 'backspace') && ui.sel.type === 'shape') {
      piece().cutouts.splice(ui.contour.idx, 1);
      clearSel();
      commit();
    } else if (ui.sel.type === 'edge' && (k === 'h' || k === 's' || k === 'n')) {
      setModes(contour(), selectedEdges(), { h: 'holes', s: 'stitch', n: 'none' }[k]);
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
