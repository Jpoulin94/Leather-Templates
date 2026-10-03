// User interface: panels, canvas editor, saving and export.
(function () {
  'use strict';
  const { model: M, geom: G, layout: Lay, render: R, pdf: P, storage: S } = window.LT;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = R.escapeXml;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const vName = (i) => (i < 26 ? LETTERS[i] : LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26]);
  const MODE_LABEL = { none: 'None', holes: 'Holes', stitch: 'Stitch line' };

  let project = S.loadCurrent() || M.newProject();
  const ui = {
    pieceIdx: 0,
    contour: { kind: 'outline', idx: 0 },
    tool: 'select',
    clickMode: 'holes',
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

  function moveContour(c, dx, dy) {
    if (c.start) c.start = { x: round(c.start.x + dx), y: round(c.start.y + dy) };
  }

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

  function restore(snapshot) {
    project = JSON.parse(snapshot);
    history.last = snapshot;
    ui.pieceIdx = Math.min(ui.pieceIdx, project.pieces.length - 1);
    if (ui.contour.kind === 'cutout' && !piece().cutouts[ui.contour.idx]) ui.contour = { kind: 'outline', idx: 0 };
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
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
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
      const first = $('input,select', dlg);
      if (first) first.focus();
    });
  }

  function lengthField(key, label, mm, hint) {
    return `<div class="field"><label for="f_${key}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</label>
      <span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" id="f_${key}" data-key="${key}" value="${fmt(mm)}"></span></div>`;
  }

  // Ask for lengths. Returns {key: mm} or null.
  async function askLengths(title, fields, okLabel = 'OK') {
    const body = fields.map((f) => lengthField(f.key, f.label, f.value, f.hint)).join('') +
      `<p class="note">Values in ${units()}. Fractions like 1 1/2 or 3/16 work too.</p>`;
    for (;;) {
      const res = await dialog(title, body, [
        { label: 'Cancel', value: 'cancel' },
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
      { label: 'Cancel', value: 'cancel' },
      { label: okLabel, value: 'ok', cls: danger ? 'danger' : 'primary' },
    ]);
    return res === 'ok';
  }

  // ---------------------------------------------------------------------
  // Shapes

  function bboxCenter() {
    const lay = Lay.layoutPiece(project, piece());
    const b = Lay.pieceBBox(lay);
    return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
  }

  async function addRectanglePiece() {
    const v = await askLengths('New rectangle piece', [
      { key: 'w', label: 'Width', value: units() === 'in' ? 101.6 : 100, positive: true },
      { key: 'h', label: 'Height', value: units() === 'in' ? 63.5 : 60, positive: true },
      { key: 'r', label: 'Corner radius', value: 0, hint: '0 for square corners' },
    ], 'Add piece');
    if (!v) return;
    project.pieces.push(M.newPiece(`Piece ${project.pieces.length + 1}`, M.rectangle(v.w, v.h, v.r, 0, 0, 'holes')));
    selectPiece(project.pieces.length - 1);
  }

  async function addCirclePiece() {
    const v = await askLengths('New circle piece', [
      { key: 'd', label: 'Diameter', value: units() === 'in' ? 76.2 : 80, positive: true },
    ], 'Add piece');
    if (!v) return;
    project.pieces.push(M.newPiece(`Piece ${project.pieces.length + 1}`, M.circle(v.d / 2, v.d / 2, v.d / 2, 'holes')));
    selectPiece(project.pieces.length - 1);
  }

  function addDrawnPiece() {
    project.pieces.push(M.newPiece(`Piece ${project.pieces.length + 1}`, M.newContour()));
    selectPiece(project.pieces.length - 1);
    startDraw();
  }

  async function addRectangleCutout() {
    const v = await askLengths('New rectangle cutout', [
      { key: 'w', label: 'Width', value: units() === 'in' ? 25.4 : 25, positive: true },
      { key: 'h', label: 'Height', value: units() === 'in' ? 12.7 : 12, positive: true },
      { key: 'r', label: 'Corner radius', value: 0 },
    ], 'Add cutout');
    if (!v) return;
    const c = bboxCenter();
    piece().cutouts.push(M.rectangle(v.w, v.h, v.r, c.x - v.w / 2, c.y - v.h / 2, 'none'));
    ui.contour = { kind: 'cutout', idx: piece().cutouts.length - 1 };
    commit();
  }

  async function addCircleCutout() {
    const v = await askLengths('New circle cutout', [
      { key: 'd', label: 'Diameter', value: units() === 'in' ? 19.05 : 20, positive: true },
    ], 'Add cutout');
    if (!v) return;
    const c = bboxCenter();
    piece().cutouts.push(M.circle(v.d / 2, c.x, c.y, 'none'));
    ui.contour = { kind: 'cutout', idx: piece().cutouts.length - 1 };
    commit();
  }

  function addDrawnCutout() {
    piece().cutouts.push(M.newContour());
    ui.contour = { kind: 'cutout', idx: piece().cutouts.length - 1 };
    startDraw();
  }

  function selectPiece(i) {
    ui.pieceIdx = Math.max(0, Math.min(project.pieces.length - 1, i));
    ui.contour = { kind: 'outline', idx: 0 };
    if (ui.tool === 'draw') ui.tool = 'select';
    ui.view = null;
    commit();
  }

  // ---------------------------------------------------------------------
  // Drawing

  function startDraw() {
    const c = contour();
    c.start = null;
    c.segments = [];
    c.closing = { mode: ui.contour.kind === 'outline' ? 'holes' : 'none', fillet: 0, corner: true };
    ui.tool = 'draw';
    commit();
  }

  function finishDraw() {
    const c = contour();
    ui.tool = 'select';
    if (c.segments.length < 2) {
      toast('A shape needs at least two lines. Use Draw to try again.');
    }
    commit();
  }

  function snapPoint(pt) {
    const c = contour();
    const s = ui.view.scale;
    if (ui.tool === 'draw' && c.start && c.segments.length >= 2 && G.dist(pt, c.start) * s < 10) {
      return { ...c.start, closes: true };
    }
    let p = pt;
    if (ui.tool === 'draw' && c.start && ui.shift) {
      const end = G.endPoint(c);
      const d = G.sub(pt, end);
      const L = G.len(d);
      const a = Math.round(Math.atan2(d.y, d.x) / G.rad(15)) * G.rad(15);
      let Ls = L;
      if (ui.snap) Ls = Math.round(L / minorStep()) * minorStep();
      return { x: end.x + Ls * Math.cos(a), y: end.y + Ls * Math.sin(a) };
    }
    if (ui.snap) {
      const st = minorStep();
      p = { x: Math.round(pt.x / st) * st, y: Math.round(pt.y / st) * st };
    }
    return p;
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
    const mode = ui.contour.kind === 'outline' ? 'holes' : 'none';
    c.segments.push(M.seg('line', { length: round(L), angle: round(((G.deg(Math.atan2(d.y, d.x)) % 360) + 360) % 360), mode }));
    commit();
  }

  const round = (v) => Math.round(v * 10000) / 10000;

  // ---------------------------------------------------------------------
  // Canvas

  const svg = $('#canvas');

  function fitView() {
    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 600;
    const lay = Lay.layoutPiece(project, piece());
    let b = Lay.pieceBBox(lay);
    if (!b || b.maxX - b.minX < 1e-6) b = { minX: -20, minY: -20, maxX: 180, maxY: 130 };
    const bw = Math.max(b.maxX - b.minX, 20);
    const bh = Math.max(b.maxY - b.minY, 20);
    const scale = Math.min(w / bw, h / bh) * 0.8;
    ui.view = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale };
  }

  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    const s = ui.view.scale;
    return {
      x: ui.view.cx + (e.clientX - r.left - r.width / 2) / s,
      y: ui.view.cy - (e.clientY - r.top - r.height / 2) / s,
    };
  }

  const flip = (p) => ({ x: p.x, y: -p.y });
  const num = (v) => Number(v.toFixed(4));

  function gridSvg(x0, y0, w, h, s) {
    const out = [];
    const inch = units() === 'in';
    let minor = inch ? 25.4 / 8 : 1;
    let major = inch ? 25.4 : 10;
    while (major * s < 30) major *= inch ? 2 : 5;
    const drawMinor = minor * s >= 6;
    const lines = (step, cls) => {
      const parts = [];
      for (let x = Math.ceil(x0 / step) * step; x <= x0 + w; x += step) parts.push(`M${num(x)} ${num(y0)}V${num(y0 + h)}`);
      for (let y = Math.ceil(y0 / step) * step; y <= y0 + h; y += step) parts.push(`M${num(x0)} ${num(y)}H${num(x0 + w)}`);
      out.push(`<path d="${parts.join('')}" stroke="var(--${cls})" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
    };
    if (drawMinor) lines(minor, 'grid-minor');
    lines(major, 'grid-major');
    // Origin axes
    out.push(`<path d="M${num(x0)} 0H${num(x0 + w)}M0 ${num(y0)}V${num(y0 + h)}" stroke="var(--grid-major)" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
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
    const contours = [
      { c: pc.outline, lay: lay.outline, kind: 'outline', idx: 0 },
      ...pc.cutouts.map((c, i) => ({ c, lay: lay.cutouts[i], kind: 'cutout', idx: i })),
    ];
    const active = contour();

    const combining = ui.combine;
    contours.forEach(({ c, lay: cl, kind, idx }) => {
      if (combining && (kind === 'outline' || idx === combining.idx)) return;
      const isActive = c === active;
      // Cutouts can be grabbed anywhere inside to select or move them.
      if (kind === 'cutout' && !combining && ui.tool === 'select') {
        out.push(`<path class="grab" d="${R.pathData(cl.prims, flip, true)}" fill="${isActive ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'}" stroke="none" data-kind="cutout" data-ci="${idx}" data-shape="1"/>`);
      }
      cl.prims.forEach((p) => {
        const d = R.pathData([p], flip, false);
        const col = `var(--edge-${p.mode})`;
        out.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${isActive ? 2.25 : 1.5}" vector-effect="non-scaling-stroke"/>`);
      });
      cl.stitch.forEach((st) => {
        out.push(`<path d="${R.pathData(st.prims, flip, st.closed)}" fill="none" stroke="var(--edge-stitch)" stroke-width="1.25" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>`);
      });
      cl.holes.forEach((hp) => {
        out.push(`<circle cx="${num(hp.x)}" cy="${num(-hp.y)}" r="${num(lay.holeRadius)}" fill="color-mix(in srgb, var(--edge-holes) 18%, transparent)" stroke="var(--edge-holes)" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
      });
      // Clickable edges (fillet arcs belong to their corner and are not clickable).
      cl.prims.forEach((p) => {
        if (p.fillet !== undefined) return;
        out.push(`<path class="hit" d="${R.pathData([p], flip, false)}" fill="none" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" data-kind="${kind}" data-ci="${idx}" data-edge="${p.edge}"/>`);
      });
    });

    // Choosing lines: pieces split where the shapes cross
    if (combining) {
      combining.pieces.forEach((pcs, i) => {
        const d = R.pathData([pcs.prim], flip, false);
        out.push(pcs.keep
          ? `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke"/>`
          : `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="1.25" stroke-dasharray="4 4" opacity="0.7" vector-effect="non-scaling-stroke"/>`);
        out.push(`<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke" data-piece="${i}"><title>Click to ${pcs.keep ? 'remove' : 'keep'} this line</title></path>`);
      });
    }

    // Labels and corner markers for the active contour
    if (ui.tool !== 'draw' && !combining) {
      const edges = G.buildEdges(active);
      const ccw = G.signedArea(edges) > 0;
      edges.forEach((e) => {
        const m = G.primPointAt(e, G.primLength(e) / 2);
        const tm = e.type === 'line' ? G.primStartTangent(e) : G.primStartTangent({ ...e, a0: e.a0 + e.sweep / 2 });
        const outN = ccw ? { x: tm.y, y: -tm.x } : { x: -tm.y, y: tm.x };
        const lp = G.add(m, G.mul(outN, px(14)));
        out.push(`<text x="${num(lp.x)}" y="${num(-lp.y)}" font-size="${num(px(11))}" text-anchor="middle" dominant-baseline="central" fill="var(--muted)" font-weight="700">${e.edge + 1}</text>`);
      });
      edges.forEach((e) => {
        const v = G.primStart(e);
        const vp = G.vertexProps(active, e.edge);
        const fill = vp.corner ? 'var(--accent)' : 'var(--canvas)';
        out.push(`<circle class="vtx" cx="${num(v.x)}" cy="${num(-v.y)}" r="${num(px(5))}" fill="${fill}" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke" data-vertex="${e.edge}"><title>Corner ${vName(e.edge)}: corner hole ${vp.corner ? 'on' : 'off'} (click to switch)</title></circle>`);
        out.push(`<text x="${num(v.x + px(8))}" y="${num(-v.y - px(8))}" font-size="${num(px(10))}" fill="var(--accent)" pointer-events="none">${vName(e.edge)}</text>`);
      });
    }

    // Zero point
    if (pc.zero.enabled) {
      const z = G.pointOnEdge(pc.outline, pc.zero.edge, pc.zero.offset);
      if (z) {
        const r = px(7);
        out.push(`<g stroke="var(--zero)" stroke-width="2" vector-effect="non-scaling-stroke" fill="none" pointer-events="none">
          <circle cx="${num(z.x)}" cy="${num(-z.y)}" r="${num(r)}" vector-effect="non-scaling-stroke"/>
          <path d="M${num(z.x - r * 1.6)} ${num(-z.y)}H${num(z.x + r * 1.6)}M${num(z.x)} ${num(-z.y - r * 1.6)}V${num(-z.y + r * 1.6)}" vector-effect="non-scaling-stroke"/></g>`);
      }
    }

    // Drawing preview
    if (ui.tool === 'draw') {
      const c = active;
      if (c.start) {
        const pts = [c.start];
        G.buildEdges(c).filter((e) => !e.closing).forEach((e) => pts.push(G.primEnd(e)));
        out.push(`<circle cx="${num(c.start.x)}" cy="${num(-c.start.y)}" r="${num(px(6))}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
        if (ui.mouse) {
          const end = pts[pts.length - 1];
          const m = snapPoint(ui.mouse);
          out.push(`<path d="M${num(end.x)} ${num(-end.y)}L${num(m.x)} ${num(-m.y)}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`);
          const d = G.sub(m, end);
          const lbl = `${fmt(G.len(d))} ${units()}  ${num(Math.round(G.deg(Math.atan2(d.y, d.x)) * 10) / 10)}°`;
          out.push(`<text x="${num(m.x + px(10))}" y="${num(-m.y - px(10))}" font-size="${num(px(12))}" fill="var(--accent)">${esc(lbl)}</text>`);
        }
      } else if (ui.mouse) {
        const m = snapPoint(ui.mouse);
        out.push(`<circle cx="${num(m.x)}" cy="${num(-m.y)}" r="${num(px(4))}" fill="var(--accent)"/>`);
      }
    }
    svg.innerHTML = out.join('');
    renderHint();
  }

  function renderHint() {
    const c = contour();
    let msg = '';
    if (ui.tool === 'draw') {
      msg = !c.start
        ? 'Click to place the first point.'
        : 'Click to add points. Hold Shift for 15° steps. Click the first point or press Enter to finish. Backspace removes the last line.';
    } else if (ui.combine) {
      msg = 'Click lines to keep (solid) or remove (dashed), then press Apply on the right. Esc cancels.';
    } else if (ui.tool === 'zero') {
      msg = 'Click an edge of the outline to place the zero point. Holes are laid out from it so matching pieces line up.';
    } else {
      msg = `Click an edge to give it ${MODE_LABEL[ui.clickMode].toLowerCase()} (click again to clear). Click a corner dot to switch its corner hole. Drag inside a cutout to move it. Drag elsewhere to pan, scroll to zoom.`;
    }
    $('#hint').textContent = msg;
  }

  function handleCanvasClick(target, world) {
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
      }
      return;
    }
    const el = target && target.closest ? target.closest('[data-edge],[data-vertex],[data-shape]') : null;
    if (!el) return;
    if (el.dataset.shape) {
      ui.contour = { kind: 'cutout', idx: Number(el.dataset.ci) };
      renderAll();
      return;
    }
    if (el.dataset.vertex !== undefined) {
      const c = contour();
      const p = edgeProps(c, Number(el.dataset.vertex));
      p.corner = p.corner === false;
      commit();
      return;
    }
    const kind = el.dataset.kind;
    const idx = Number(el.dataset.ci);
    const src = Number(el.dataset.edge);
    if (ui.tool === 'zero') {
      if (kind !== 'outline') {
        toast('The zero point goes on the outline.');
        return;
      }
      const e = G.buildEdges(piece().outline).find((x) => x.edge === src);
      piece().zero = { enabled: true, edge: src, offset: round(G.projectOnPrim(e, world)) };
      ui.tool = 'select';
      commit();
      return;
    }
    ui.contour = { kind, idx };
    const c = contour();
    const p = edgeProps(c, src);
    p.mode = p.mode === ui.clickMode ? 'none' : ui.clickMode;
    commit();
  }

  svg.addEventListener('pointerdown', (e) => {
    ui.ptr = { x: e.clientX, y: e.clientY, cx: ui.view.cx, cy: ui.view.cy, moved: false, target: e.target, button: e.button };
    const grab = e.button === 0 && ui.tool === 'select' && !ui.combine && e.target.closest
      ? e.target.closest('[data-kind="cutout"]')
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
        ui.contour = { kind: 'cutout', idx: ui.ptr.drag.idx };
      } else if (ui.ptr.moved) {
        ui.view.cx = ui.ptr.cx - dx / ui.view.scale;
        ui.view.cy = ui.ptr.cy + dy / ui.view.scale;
      }
    }
    renderCanvas();
  });
  svg.addEventListener('pointerup', (e) => {
    const p = ui.ptr;
    ui.ptr = null;
    if (p && p.drag && p.moved) {
      commit();
      return;
    }
    if (p && !p.moved && p.button === 0) handleCanvasClick(p.target, toWorld(e));
  });
  svg.addEventListener('pointerleave', () => {
    if (!ui.ptr) {
      ui.mouse = null;
      renderCanvas();
    }
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const before = toWorld(e);
      const k = Math.exp(-e.deltaY * 0.0015);
      ui.view.scale = Math.max(0.05, Math.min(200, ui.view.scale * k));
      const after = toWorld(e);
      ui.view.cx += before.x - after.x;
      ui.view.cy += before.y - after.y;
      renderCanvas();
    },
    { passive: false }
  );

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProject();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !typing && !$('#dialog').open) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
      }
    }
    if (typing || $('#dialog').open) return;
    if (e.key === 'Shift') {
      ui.shift = true;
      renderCanvas();
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
    } else if (e.key === 'Escape' && ui.combine) {
      ui.combine = null;
      renderAll();
    } else if (e.key === 'Escape' && ui.tool !== 'select') {
      ui.tool = 'select';
      renderAll();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      ui.shift = false;
      renderCanvas();
    }
  });
  window.addEventListener('resize', renderCanvas);

  // ---------------------------------------------------------------------
  // Left panel: settings, pieces, output

  function settingsFields(obj, prefix) {
    return [
      ['holeDiameter', 'Hole diameter', 'Size of your round punch'],
      ['spacing', 'Hole spacing', 'Centre of one hole to centre of the next'],
      ['edgeDistance', 'Hole edge to leather edge', 'Gap between the hole and the edge'],
      ['stitchOffset', 'Stitch line from edge', 'Used on edges set to stitch line'],
    ]
      .map(([k, label, hint]) =>
        `<div class="field"><label for="${prefix}${k}">${label}<small>${hint}</small></label>
        <span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" id="${prefix}${k}" data-set="${prefix}" data-key="${k}" value="${fmt(obj[k])}"></span></div>`)
      .join('');
  }

  function renderLeft() {
    const pc = piece();
    const pieces = project.pieces
      .map((p, i) => `<li data-piece="${i}" class="${i === ui.pieceIdx ? 'on' : ''}">
          <input type="checkbox" data-export="${i}" ${p.export === false ? '' : 'checked'} title="Include in print and laser output">
          <span class="name">${esc(p.name)}</span></li>`)
      .join('');
    const eff = Lay.pieceSettings(project, pc);
    $('#leftPanel').innerHTML = `
      <section>
        <h2>Hole &amp; stitch settings</h2>
        ${settingsFields(project.defaults, 'd_')}
        <p class="note">These apply to every piece unless a piece has its own.</p>
      </section>
      <section>
        <h2>Pieces</h2>
        <ul class="pieces">${pieces}</ul>
        <div class="row"><span class="muted">Add:</span>
          <button class="small" id="addRect">Rectangle</button>
          <button class="small" id="addCircle">Circle</button>
          <button class="small" id="addDraw">Draw my own</button></div>
      </section>
      <section>
        <h2>This piece</h2>
        <div class="field" style="grid-template-columns: 70px 1fr"><label for="pieceName">Name</label>
          <input type="text" id="pieceName" value="${esc(pc.name)}"></div>
        <div class="row">
          <button class="small" id="dupPiece">Duplicate</button>
          <button class="small danger" id="delPiece" ${project.pieces.length < 2 ? 'disabled' : ''}>Delete</button>
        </div>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="customSettings" ${pc.customSettings ? 'checked' : ''}> Use different hole settings for this piece</label>
        ${pc.customSettings ? settingsFields(eff, 'p_') : ''}
      </section>
      <section>
        <h2>Output</h2>
        <div class="field" style="grid-template-columns: 1fr 120px"><label for="paper">Paper</label>
          <select id="paper">${Object.entries(P.PAPER).map(([k, v]) => `<option value="${k}" ${k === ui.paper ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        <div class="row">
          <button class="primary" id="btnPdf">Printable PDF (1:1)</button>
          <button id="btnSvg">Laser SVG</button>
        </div>
        <p class="note">Ticked pieces are included. Print the PDF at 100% / “Actual size”, then measure the check square. In the SVG, red is cut and blue is score/engrave.</p>
      </section>`;
  }

  $('#leftPanel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.set) {
      const v = M.parseLength(t.value, units());
      if (!Number.isFinite(v) || v < 0) {
        t.classList.add('bad');
        toast('Please enter a valid size.');
        return;
      }
      if (t.dataset.set === 'd_') project.defaults[t.dataset.key] = v;
      else piece().settings[t.dataset.key] = v;
      commit();
    } else if (t.dataset.export !== undefined) {
      project.pieces[Number(t.dataset.export)].export = t.checked;
      commit();
    } else if (t.id === 'pieceName') {
      piece().name = t.value.trim() || piece().name;
      commit();
    } else if (t.id === 'customSettings') {
      const pc = piece();
      if (t.checked && !Object.keys(pc.settings).length) pc.settings = { ...project.defaults };
      pc.customSettings = t.checked;
      commit();
    } else if (t.id === 'paper') {
      ui.paper = t.value;
    }
  });

  $('#leftPanel').addEventListener('click', async (e) => {
    const t = e.target;
    const li = t.closest('[data-piece]');
    if (li && t.tagName !== 'INPUT') {
      selectPiece(Number(li.dataset.piece));
      return;
    }
    switch (t.id) {
      case 'addRect':
        return addRectanglePiece();
      case 'addCircle':
        return addCirclePiece();
      case 'addDraw':
        return addDrawnPiece();
      case 'dupPiece': {
        const copy = JSON.parse(JSON.stringify(piece()));
        copy.id = M.uid();
        copy.name = `${piece().name} copy`;
        project.pieces.splice(ui.pieceIdx + 1, 0, copy);
        return selectPiece(ui.pieceIdx + 1);
      }
      case 'delPiece':
        if (await confirmDialog('Delete piece', `Delete “${piece().name}”?`, 'Delete', true)) {
          project.pieces.splice(ui.pieceIdx, 1);
          selectPiece(ui.pieceIdx - 1);
        }
        return;
      case 'btnPdf':
        return exportPdf();
      case 'btnSvg':
        return exportSvg();
      default:
    }
  });

  function exportPieces() {
    const list = project.pieces.filter((p) => p.export !== false && p.outline.segments.length);
    if (!list.length) toast('Tick at least one piece with a shape.');
    return list;
  }

  function exportPdf() {
    const list = exportPieces();
    if (!list.length) return;
    S.downloadBinary(`${S.safeFilename(project.name)}.pdf`, P.buildPdf(project, list, ui.paper), 'application/pdf');
    toast('PDF downloaded. Print at 100% / Actual size.');
  }

  function exportSvg() {
    const list = exportPieces();
    if (!list.length) return;
    S.download(`${S.safeFilename(project.name)}.svg`, R.buildSvg(project, list), 'image/svg+xml');
    toast('SVG downloaded.');
  }

  // ---------------------------------------------------------------------
  // Right panel: shape editor

  function renderCombinePanel() {
    const kept = ui.combine.pieces.filter((x) => x.keep).length;
    $('#rightPanel').innerHTML = `
      <section>
        <h2>Choose lines</h2>
        <p>The outline and cutout ${ui.combine.idx + 1} are split wherever they cross. Click a line on the drawing to keep it (solid) or remove it (dashed). The kept lines must join up into one closed shape.</p>
        <div class="row"><span class="muted">Start from:</span>
          <button class="small" data-preset="cut">Cut away</button>
          <button class="small" data-preset="merge">Merge</button>
          <button class="small" data-preset="overlap">Overlap</button></div>
        <p class="ok">${kept} of ${ui.combine.pieces.length} lines kept.</p>
        <div class="row">
          <button class="primary" id="applyLines">Apply</button>
          <button id="cancelLines">Cancel</button>
        </div>
      </section>`;
  }

  function renderShapeTools(pc) {
    const c = contour();
    const b = contourBox(c);
    if (!b) return '';
    const targets = [`<option value="outline">Outline</option>`]
      .concat(pc.cutouts.map((_, i) => (i === ui.contour.idx ? '' : `<option value="cutout:${i}">Cutout ${i + 1}</option>`)))
      .join('');
    const lenInput = (id, mm) =>
      `<span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" id="${id}" value="${fmt(mm)}" style="width:86px"></span>`;
    return `
      <section>
        <h2>Position &amp; align</h2>
        <div class="row">
          <label>Centre X ${lenInput('posX', (b.minX + b.maxX) / 2)}</label>
          <label>Y ${lenInput('posY', (b.minY + b.maxY) / 2)}</label>
        </div>
        <div class="field" style="grid-template-columns: 1fr 140px"><label for="alignTarget">Line it up with</label>
          <select id="alignTarget">${targets}</select></div>
        <div class="align-grid">
          <span>Side to side</span>
          <button class="small" data-align="left">Left edges</button>
          <button class="small" data-align="hcenter">Centres</button>
          <button class="small" data-align="right">Right edges</button>
          <span>Up and down</span>
          <button class="small" data-align="bottom">Bottoms</button>
          <button class="small" data-align="vmiddle">Middles</button>
          <button class="small" data-align="top">Tops</button>
          <span>Centre on its edge</span>
          <button class="small" data-align="onTop">Top</button>
          <button class="small" data-align="onBottom">Bottom</button>
          <button class="small" data-align="onLeft">Left</button>
          <button class="small" data-align="onRight">Right</button>
        </div>
        <p class="note">You can also drag the shape on the drawing.</p>
      </section>
      <section>
        <h2>Combine with the outline</h2>
        <div class="row">
          <button class="small" data-combine="cut" title="Remove this shape's area from the outline">Cut away</button>
          <button class="small" data-combine="merge" title="Add this shape's area to the outline">Merge</button>
          <button class="small" data-combine="overlap" title="Keep only where the two overlap">Keep overlap</button>
          <button class="small" id="chooseLines" title="Pick which lines to keep">Choose lines…</button>
        </div>
        <p class="note">Until you combine it, this shape is a cutout (a hole inside the piece). Thumb notch on a card pocket: add a circle, line it up with <b>Centres</b> and <b>Centre on its edge: Top</b>, then <b>Cut away</b>.</p>
      </section>`;
  }

  function renderRight() {
    if (ui.combine) {
      renderCombinePanel();
      return;
    }
    const pc = piece();
    const c = contour();
    const n = c.segments.length;
    const closing = G.closingEdge(c);
    const contourOpts = [`<option value="outline:0">Outline</option>`]
      .concat(pc.cutouts.map((_, i) => `<option value="cutout:${i}">Cutout ${i + 1}</option>`))
      .join('');
    const modeSel = (src, mode) =>
      `<select data-mode-edge="${src}">${['none', 'holes', 'stitch'].map((m) => `<option value="${m}" ${m === mode ? 'selected' : ''}>${MODE_LABEL[m]}</option>`).join('')}</select>`;
    const inp = (i, key, val, isLen = true) =>
      `<input type="text" inputmode="decimal" data-seg="${i}" data-key="${key}" value="${isLen ? fmt(val) : num(Number(val) || 0)}">`;

    const segRows = c.segments
      .map((s, i) => {
        const a = s.type === 'arc';
        return `<tr>
          <td><span class="tag">${i + 1}</span></td>
          <td><select data-seg="${i}" data-key="type"><option value="line" ${a ? '' : 'selected'}>Line</option><option value="arc" ${a ? 'selected' : ''}>Arc</option></select></td>
          <td>${a ? inp(i, 'radius', s.radius) : inp(i, 'length', s.length)}</td>
          <td>${inp(i, 'angle', s.angle, false)}</td>
          <td>${a ? inp(i, 'sweep', s.sweep, false) : ''}</td>
          <td>${modeSel(i, s.mode || 'none')}</td>
          <td><button class="small" data-del-seg="${i}" title="Remove">✕</button></td></tr>`;
      })
      .join('');
    const closeRow = closing
      ? `<tr><td><span class="tag">${n + 1}</span></td><td class="ro">Closing</td>
          <td class="ro">${fmt(closing.length)}</td><td class="ro">${num(Math.round(closing.angle * 100) / 100)}</td><td></td>
          <td>${modeSel(n, c.closing.mode || 'none')}</td><td></td></tr>`
      : '';

    const edges = G.buildEdges(c);
    const vRows = edges
      .map((e) => {
        const vp = G.vertexProps(c, e.edge);
        return `<tr><td><span class="tag">${vName(e.edge)}</span></td>
          <td><span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" data-fillet="${e.edge}" value="${fmt(vp.fillet)}"></span></td>
          <td style="text-align:center"><input type="checkbox" data-corner="${e.edge}" ${vp.corner ? 'checked' : ''}></td></tr>`;
      })
      .join('');

    const lay = Lay.layoutPiece(project, pc);
    const cl = ui.contour.kind === 'outline' ? lay.outline : lay.cutouts[ui.contour.idx];
    const adjusted = (cl ? cl.sections : []).filter((s) => s.actual && Math.abs(s.actual - s.requested) > 0.005);
    const holeCount = cl ? cl.holes.length : 0;

    const outlineEdges = G.buildEdges(pc.outline);
    const zeroEdge = outlineEdges.find((e) => e.edge === pc.zero.edge);
    const zeroHtml = ui.contour.kind === 'outline'
      ? `<section><h2>Zero point</h2>
          <label class="check"><input type="checkbox" id="zeroOn" ${pc.zero.enabled ? 'checked' : ''}> Lay holes out from a zero point</label>
          ${pc.zero.enabled ? `
          <div class="field" style="grid-template-columns: 1fr 92px"><label for="zeroEdge">On edge</label>
            <select id="zeroEdge">${outlineEdges.map((e) => `<option value="${e.edge}" ${e.edge === pc.zero.edge ? 'selected' : ''}>Edge ${e.edge + 1}</option>`).join('')}</select></div>
          <div class="field"><label for="zeroOffset">Distance from the start of the edge<small>Edge length ${zeroEdge ? fmt(G.primLength(zeroEdge)) : '?'} ${units()}</small></label>
            <span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" id="zeroOffset" value="${fmt(pc.zero.offset)}"></span></div>
          <div class="row"><button class="small" id="zeroPick">Pick on drawing</button></div>` : ''}
          <p class="note">A hole always lands on the zero point. Give mating pieces the same zero point and settings, and their holes line up when stacked.</p>
        </section>`
      : '';

    $('#rightPanel').innerHTML = `
      <section>
        <h2>Shape</h2>
        <div class="row">
          <select id="contourSel">${contourOpts}</select>
          ${ui.contour.kind === 'cutout' ? '<button class="small danger" id="delCutout">Delete cutout</button>' : ''}
          <button class="small" id="redraw" title="Clear this shape and draw it again">Redraw</button>
        </div>
        <div class="row"><span class="muted">Add shape:</span>
          <button class="small" id="cutRect">Rectangle</button>
          <button class="small" id="cutCircle">Circle</button>
          <button class="small" id="cutDraw">Draw</button></div>
      </section>
      ${ui.contour.kind === 'cutout' ? renderShapeTools(pc) : ''}
      <section>
        <h2>Start point</h2>
        <div class="row">
          <label>X <span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" id="startX" value="${c.start ? fmt(c.start.x) : ''}" style="width:80px"></span></label>
          <label>Y <span class="unit" data-unit="${units()}"><input type="text" inputmode="decimal" id="startY" value="${c.start ? fmt(c.start.y) : ''}" style="width:80px"></span></label>
        </div>
      </section>
      <section>
        <h2>Edges</h2>
        <table class="edit fixed">
          <colgroup><col style="width:28px"><col style="width:62px"><col><col style="width:62px"><col style="width:52px"><col style="width:86px"><col style="width:28px"></colgroup>
          <thead><tr><th>#</th><th>Type</th><th>Length / radius</th><th>Angle °</th><th>Sweep °</th><th>On edge</th><th></th></tr></thead>
          <tbody>${segRows}${closeRow}</tbody>
        </table>
        <div class="row"><button class="small" id="addLine">+ Line</button><button class="small" id="addArc">+ Arc</button></div>
        <p class="note">Angle is the direction the edge starts in: 0° right, 90° up, 180° left, 270° down. An arc's sweep is how far it turns: positive turns left, negative turns right. If the last edge doesn't end at the start, a closing edge is added.</p>
      </section>
      <section>
        <h2>Corners</h2>
        <table class="edit">
          <thead><tr><th>Corner</th><th>Rounded radius (${units()})</th><th>Corner hole</th></tr></thead>
          <tbody>${vRows}</tbody>
        </table>
        <p class="note">With a corner hole on, a hole always lands exactly on that corner and the spacing along each side is adjusted slightly to fit. Rounded corners have no single corner point, so holes simply follow the curve.</p>
      </section>
      ${zeroHtml}
      <section>
        <h2>Spacing check</h2>
        <p class="ok">${holeCount} hole${holeCount === 1 ? '' : 's'} on this shape.</p>
        ${adjusted.length
          ? adjusted.map((s) => `<div class="warn">A ${fmt(s.length)} ${units()} run uses ${fmt(s.actual)} ${units()} spacing (you asked for ${fmt(s.requested)}) so the holes divide evenly.</div>`).join('')
          : holeCount ? '<p class="ok">Every run uses your exact spacing.</p>' : ''}
      </section>`;
    $('#contourSel').value = `${ui.contour.kind}:${ui.contour.kind === 'outline' ? 0 : ui.contour.idx}`;
    const at = $('#alignTarget');
    if (at) {
      at.value = ui.alignTarget;
      if (at.value !== ui.alignTarget) at.value = ui.alignTarget = 'outline';
    }
  }

  // ---------------------------------------------------------------------
  // Aligning and combining shapes

  function alignShape(how) {
    const pc = piece();
    const c = contour();
    const target = ui.alignTarget.startsWith('cutout:')
      ? pc.cutouts[Number(ui.alignTarget.split(':')[1])]
      : pc.outline;
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
    const shape = pc.cutouts[idx];
    const res = LT.boolean.combine(pc.outline, shape, op, pieces);
    if (!res.outline) {
      toast(pieces ? 'The kept lines don’t join into a closed shape.' : 'Those shapes don’t overlap, so there is nothing to keep.');
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
    ui.contour = { kind: 'outline', idx: 0 };
    ui.combine = null;
    commit();
    const notes = [];
    if (res.extra) notes.push(`The result came apart into ${res.extra + 1} parts; the largest was kept.`);
    if (res.open) notes.push('Some kept lines didn’t connect and were left out.');
    toast(notes.length ? notes.join(' ') : 'Combined. Use Undo if it isn’t what you wanted.');
    return true;
  }

  function startChooseLines(idx) {
    const pc = piece();
    const A = G.buildPrimitives(pc.outline);
    const B = G.buildPrimitives(pc.cutouts[idx]);
    const pieces = LT.boolean.preset(LT.boolean.splitShapes(A, B), 'cut');
    ui.combine = { idx, pieces };
    ui.tool = 'select';
    renderAll();
  }

  $('#rightPanel').addEventListener('change', (e) => {
    const t = e.target;
    const c = contour();
    if (t.id === 'contourSel') {
      const [kind, idx] = t.value.split(':');
      ui.contour = { kind, idx: Number(idx) };
      if (ui.tool === 'draw') ui.tool = 'select';
      return commit();
    }
    if (t.dataset.modeEdge !== undefined) {
      edgeProps(c, Number(t.dataset.modeEdge)).mode = t.value;
      return commit();
    }
    if (t.dataset.corner !== undefined) {
      edgeProps(c, Number(t.dataset.corner)).corner = t.checked;
      return commit();
    }
    if (t.dataset.fillet !== undefined) {
      const v = M.parseLength(t.value, units());
      if (!Number.isFinite(v) || v < 0) return bad(t);
      edgeProps(c, Number(t.dataset.fillet)).fillet = v;
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
    const pc = piece();
    if (t.id === 'zeroOn') {
      pc.zero.enabled = t.checked;
      return commit();
    }
    if (t.id === 'zeroEdge') {
      pc.zero.edge = Number(t.value);
      pc.zero.offset = 0;
      return commit();
    }
    if (t.id === 'zeroOffset') {
      const v = M.parseLength(t.value, units());
      if (!Number.isFinite(v) || v < 0) return bad(t);
      pc.zero.offset = v;
      return commit();
    }
    return undefined;
  });

  function bad(input) {
    input.classList.add('bad');
    toast('That value is not valid.');
  }

  $('#rightPanel').addEventListener('click', async (e) => {
    const t = e.target;
    const c = contour();
    if (t.dataset.delSeg !== undefined) {
      c.segments.splice(Number(t.dataset.delSeg), 1);
      return commit();
    }
    if (t.dataset.align) return alignShape(t.dataset.align);
    if (t.dataset.combine) return applyCombine(ui.contour.idx, t.dataset.combine);
    if (t.dataset.preset && ui.combine) {
      LT.boolean.preset(ui.combine.pieces, t.dataset.preset);
      return renderAll();
    }
    if (t.id === 'chooseLines') return startChooseLines(ui.contour.idx);
    if (t.id === 'applyLines' && ui.combine) return applyCombine(ui.combine.idx, null, ui.combine.pieces);
    if (t.id === 'cancelLines') {
      ui.combine = null;
      return renderAll();
    }
    switch (t.id) {
      case 'addLine':
      case 'addArc': {
        if (!c.start) c.start = { x: 0, y: 0 };
        const angle = round(G.endHeading(c));
        const mode = ui.contour.kind === 'outline' ? 'holes' : 'none';
        const s = t.id === 'addLine'
          ? M.seg('line', { length: units() === 'in' ? 25.4 : 20, angle, mode })
          : M.seg('arc', { radius: units() === 'in' ? 12.7 : 15, sweep: 90, angle, mode });
        c.segments.push(s);
        return commit();
      }
      case 'redraw':
        if (!c.segments.length || (await confirmDialog('Redraw shape', 'Clear this shape and draw it again?', 'Redraw'))) startDraw();
        return undefined;
      case 'delCutout':
        if (await confirmDialog('Delete cutout', `Delete cutout ${ui.contour.idx + 1}?`, 'Delete', true)) {
          piece().cutouts.splice(ui.contour.idx, 1);
          ui.contour = { kind: 'outline', idx: 0 };
          commit();
        }
        return undefined;
      case 'cutRect':
        return addRectangleCutout();
      case 'cutCircle':
        return addCircleCutout();
      case 'cutDraw':
        return addDrawnCutout();
      case 'zeroPick':
        ui.tool = 'zero';
        return renderAll();
      default:
        return undefined;
    }
  });

  // ---------------------------------------------------------------------
  // Top bar: project, saving, units, tools

  function renderTop() {
    const nameEl = $('#projectName');
    if (document.activeElement !== nameEl) nameEl.value = project.name;
    $$('[data-units]').forEach((b) => b.classList.toggle('on', b.dataset.units === units()));
    $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === ui.tool));
    $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.clickMode));
    $('#snap').checked = ui.snap;
    $('#btnUndo').disabled = !history.undo.length;
    $('#btnRedo').disabled = !history.redo.length;
    document.title = `${project.name}${ui.dirty ? ' •' : ''} – Leather Templates`;
  }

  function renderAll() {
    renderTop();
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
      toast('Could not save in this browser. Try “Download project file” instead.');
      return;
    }
    ui.savedName = name;
    ui.dirty = false;
    renderTop();
    toast(`Saved “${name}”.`);
  }

  async function guardUnsaved() {
    if (!ui.dirty) return true;
    return confirmDialog('Unsaved changes', 'This project has changes that are not saved. Continue anyway?', 'Continue', true);
  }

  function loadProject(p, savedName = null) {
    project = p;
    ui.pieceIdx = 0;
    ui.contour = { kind: 'outline', idx: 0 };
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
      await dialog('Open project', '<p>No saved projects in this browser yet. Use Save to keep one, or “Load project file” to open a downloaded one.</p>', [{ label: 'Close', value: 'x' }]);
      return;
    }
    const body = `<ul class="saved-list">${items
      .map((it) => `<li><span class="name">${esc(it.name)}</span>
        <span class="muted">${it.savedAt ? new Date(it.savedAt).toLocaleString() : ''}</span>
        <button type="button" class="small primary" data-open="${esc(it.name)}">Open</button>
        <button type="button" class="small danger" data-remove="${esc(it.name)}">Delete</button></li>`)
      .join('')}</ul>`;
    let chosen = null;
    const res = dialog('Open project', body, [{ label: 'Close', value: 'x' }], (dlg) => {
      $('#dialogBody', dlg).onclick = async (e) => {
        const t = e.target;
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
    await res;
    if (chosen && (await guardUnsaved())) {
      const p = S.load(chosen);
      if (p) {
        loadProject(p, chosen);
        toast(`Opened “${chosen}”.`);
      }
    }
  }

  $('#projectName').addEventListener('change', (e) => {
    project.name = e.target.value.trim() || 'Untitled project';
    commit();
  });
  $('#btnSave').addEventListener('click', saveProject);
  $('#btnOpen').addEventListener('click', openDialog);
  $('#btnNew').addEventListener('click', async () => {
    if (await guardUnsaved()) loadProject(M.newProject());
  });
  $('#btnExportFile').addEventListener('click', () => {
    S.download(`${S.safeFilename(project.name)}.leather.json`, JSON.stringify(project, null, 2), 'application/json');
  });
  $('#btnImportFile').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !(await guardUnsaved())) return;
    try {
      loadProject(M.normalizeProject(JSON.parse(await file.text())));
      toast(`Loaded “${project.name}”.`);
    } catch (err) {
      toast('That file is not a Leather Templates project.');
    }
  });
  $$('[data-units]').forEach((b) =>
    b.addEventListener('click', () => {
      project.units = b.dataset.units;
      commit();
    })
  );
  $$('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      const tool = b.dataset.tool;
      if (tool === 'draw') {
        if (ui.tool === 'draw') return;
        const c = contour();
        if (c.segments.length) {
          confirmDialog('Redraw shape', 'Drawing replaces the selected shape. Continue?', 'Draw').then((ok) => ok && startDraw());
          return;
        }
        startDraw();
        return;
      }
      if (ui.tool === 'draw') finishDraw();
      ui.tool = tool;
      renderAll();
    })
  );
  $$('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.clickMode = b.dataset.mode;
      if (ui.tool !== 'select') ui.tool = 'select';
      renderAll();
    })
  );
  $('#snap').addEventListener('change', (e) => {
    ui.snap = e.target.checked;
  });
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnFit').addEventListener('click', () => {
    fitView();
    renderCanvas();
  });

  ui.dirty = false;
  renderAll();
  // Layout may settle after first paint.
  requestAnimationFrame(() => {
    ui.view = null;
    renderCanvas();
  });

  window.LT.app = { get project() { return project; }, ui };
})();
