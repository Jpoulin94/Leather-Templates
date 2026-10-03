// Saving projects by name in the browser, plus file export/import.
(function (root) {
  'use strict';
  const LT = (root.LT = root.LT || {});

  const KEY = 'leather-templates.projects';
  const CURRENT = 'leather-templates.current';

  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeAll(all) {
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  function list() {
    const all = readAll();
    return Object.keys(all)
      .map((name) => ({ name, savedAt: all[name].savedAt }))
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }

  function exists(name) {
    return Object.prototype.hasOwnProperty.call(readAll(), name);
  }

  function save(project) {
    const all = readAll();
    all[project.name] = { savedAt: new Date().toISOString(), project };
    writeAll(all);
  }

  function load(name) {
    const entry = readAll()[name];
    return entry ? LT.model.normalizeProject(entry.project) : null;
  }

  function remove(name) {
    const all = readAll();
    delete all[name];
    writeAll(all);
  }

  // Work in progress survives a page reload even when not saved.
  function saveCurrent(project) {
    try {
      localStorage.setItem(CURRENT, JSON.stringify(project));
    } catch (e) {
      /* storage full or blocked: ignore */
    }
  }

  function loadCurrent() {
    try {
      const p = JSON.parse(localStorage.getItem(CURRENT));
      return p ? LT.model.normalizeProject(p) : null;
    } catch (e) {
      return null;
    }
  }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Binary-safe download of an ASCII/latin1 string (used for the PDF).
  function downloadBinary(filename, str, type) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    download(filename, new Blob([bytes], { type }));
  }

  function safeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project';
  }

  LT.storage = { list, exists, save, load, remove, saveCurrent, loadCurrent, download, downloadBinary, safeFilename };
})(typeof window !== 'undefined' ? window : globalThis);
