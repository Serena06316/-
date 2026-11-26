/* =====================================================================
   ui.js —— 基础 UI 工具：DOM 构建、图标、对话框、Toast、主题、通用工具
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  /* ---------------- DOM 构建 ---------------- */
  function appendKids(node, children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { appendKids(node, c); }
      else if (c instanceof Node) { node.appendChild(c); }
      else { node.appendChild(document.createTextNode(String(c))); }
    }
  }

  var BOOL_PROPS = { disabled: 1, checked: 1, selected: 1, hidden: 1, multiple: 1, readonly: 1, required: 1, autofocus: 1 };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') { node.className = v; }
        else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
        else if (k === 'style') { node.style.cssText = v; }
        else if (k === 'html') { node.innerHTML = v; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        }
        else if (BOOL_PROPS[k]) { node[k] = !!v; }
        else if (k === 'value' || k === 'href' || k === 'id' || k === 'title' || k === 'placeholder' ||
                 k === 'rows' || k === 'type' || k === 'name' || k === 'for' || k === 'min' || k === 'max') {
          try { node[k] = v; } catch (e) { node.setAttribute(k, v); }
        }
        else { node.setAttribute(k, String(v)); }
      }
    }
    appendKids(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }
  T.el = el;

  /* ---------------- 图标（内联 SVG，风格参照 Feather Icons MIT） ---------------- */
  var I = {
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    folderPlus: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    starFill: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    xCircle: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };

  T.icon = function (name, cls) {
    var klass = 'icon';
    if (typeof cls === 'string') klass += ' ' + cls;
    else if (cls && cls.class) klass += ' ' + cls.class;
    var fill = (name === 'starFill') ? 'currentColor' : 'none';
    return el('span', {
      class: klass,
      html: '<svg viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>'
    });
  };

  /* ---------------- 视图生命周期清理 ---------------- */
  var cleanups = [];
  T.onCleanup = function (fn) { cleanups.push(fn); };
  T.runCleanups = function () {
    while (cleanups.length) {
      try { cleanups.pop()(); } catch (e) { /* 忽略 */ }
    }
  };

  /* ---------------- Toast ---------------- */
  var TOAST_ICON = { success: 'checkCircle', error: 'xCircle', warning: 'alertCircle', info: 'info' };
  T.toast = function (msg, type, duration) {
    type = type || 'info';
    duration = duration || 2800;
    var root = document.getElementById('toast-root');
    if (!root) return;
    var node = el('div', { class: 'toast toast-' + type }, T.icon(TOAST_ICON[type] || 'info'), el('span', {}, String(msg)));
    root.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('show'); });
    setTimeout(function () {
      node.classList.remove('show');
      setTimeout(function () { node.remove(); }, 250);
    }, duration);
  };

  /* ---------------- 模态框 ---------------- */
  var modalStack = [];
  T.openModal = function (opts) {
    opts = opts || {};
    var root = document.getElementById('modal-root');
    var closed = false;
    var overlay = el('div', { class: 'modal-overlay' });
    var box = el('div', { class: 'modal' + (opts.wide ? ' modal-wide' : '') });
    var m = { overlay: overlay, box: box, close: close, isModal: true };

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onEsc, true);
      var i = modalStack.indexOf(m);
      if (i >= 0) modalStack.splice(i, 1);
      overlay.classList.remove('show');
      setTimeout(function () { overlay.remove(); }, 160);
      if (opts.onClose) opts.onClose();
    }
    function onEsc(e) {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === m) {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    }

    var head = el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title' }, opts.title || ''),
      el('button', { class: 'icon-btn modal-close', 'aria-label': '关闭', title: '关闭', onClick: close }, T.icon('x'))
    );
    box.appendChild(head);
    var body = el('div', { class: 'modal-body' });
    if (opts.node) body.appendChild(opts.node);
    box.appendChild(body);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    root.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    document.addEventListener('keydown', onEsc, true);
    modalStack.push(m);
    return m;
  };
  T.isModalOpen = function () { return modalStack.length > 0; };

  /* 确认框 → Promise<boolean> */
  T.confirm = function (opts) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      var m = T.openModal({
        title: opts.title || '确认操作',
        onClose: function () { done(false); }
      });
      m.box.querySelector('.modal-body').appendChild(el('div', {},
        el('div', { class: 'modal-message' }, opts.message || ''),
        el('div', { class: 'modal-foot' },
          el('button', { class: 'btn btn-ghost', onClick: function () { done(false); m.close(); } }, opts.cancelText || '取消'),
          el('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), onClick: function () { done(true); m.close(); } }, opts.confirmText || '确认')
        )
      ));
    });
  };

  /* 输入框 → Promise<string|null>（返回 null 表示取消） */
  T.prompt = function (opts) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      var input = el('input', { type: 'text', value: opts.value || '', placeholder: opts.placeholder || '', autofocus: true });
      var err = el('div', { class: 'input-error' });
      var m = T.openModal({ title: opts.title || '输入', onClose: function () { done(null); } });
      function submit() {
        var v = String(input.value || '').trim();
        if (!v) { err.textContent = opts.emptyError || '内容不能为空'; return; }
        if (opts.validator) {
          var r = opts.validator(v);
          if (r !== true && r != null) { err.textContent = String(r); return; }
        }
        done(v); m.close();
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      m.box.querySelector('.modal-body').appendChild(el('div', {},
        opts.label ? el('label', { class: 'field-label' }, opts.label) : null,
        input, err,
        el('div', { class: 'modal-foot' },
          el('button', { class: 'btn btn-ghost', onClick: function () { done(null); m.close(); } }, '取消'),
          el('button', { class: 'btn btn-primary', onClick: submit }, opts.confirmText || '确定')
        )
      ));
      setTimeout(function () { try { input.focus(); input.select(); } catch (e) { /* 忽略 */ } }, 60);
    });
  };

  /* 选项选择 → Promise<key|null> */
  T.choice = function (opts) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      var m = T.openModal({ title: opts.title || '请选择', onClose: function () { done(null); } });
      var body = el('div', {});
      if (opts.message) body.appendChild(el('div', { class: 'modal-message' }, opts.message));
      var choices = el('div', { class: 'modal-choices' });
      (opts.choices || []).forEach(function (c) {
        choices.appendChild(el('button', {
          class: 'modal-choice' + (c.danger ? ' danger' : ''),
          onClick: function () { done(c.key); m.close(); }
        },
          el('span', { class: 'modal-choice-label' }, c.label),
          c.desc ? el('span', { class: 'modal-choice-desc' }, c.desc) : null
        ));
      });
      body.appendChild(choices);
      body.appendChild(el('div', { class: 'modal-foot' },
        el('button', { class: 'btn btn-ghost', onClick: function () { done(null); m.close(); } }, '取消')
      ));
      m.box.querySelector('.modal-body').appendChild(body);
    });
  };

  /* ---------------- 主题 ---------------- */
  T.setTheme = function (t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('tiku-theme', t); } catch (e) { /* 忽略 */ }
    if (T.refreshThemeIcon) T.refreshThemeIcon();
  };
  T.initTheme = function () {
    var t = null;
    try { t = localStorage.getItem('tiku-theme'); } catch (e) { /* 忽略 */ }
    if (t !== 'light' && t !== 'dark') {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
  };
  T.toggleTheme = function () {
    var cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    T.setTheme(cur === 'dark' ? 'light' : 'dark');
  };

  /* ---------------- 通用工具 ---------------- */
  T.uuid = function () {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* 忽略 */ }
    try {
      var b = window.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
    } catch (e) {
      return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }
  };

  T.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  T.stableStringify = function (v) {
    if (Array.isArray(v)) return '[' + v.map(T.stableStringify).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + T.stableStringify(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  };

  T.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 400);
  };

  T.pct = function (x) {
    if (x == null || isNaN(x)) return '—';
    var s = (x * 100).toFixed(1);
    if (s.slice(-2) === '.0') s = s.slice(0, -2);
    return s + '%';
  };

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  T.fmtTime = function (ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  T.fmtDate = function (ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  T.relTime = function (ts) {
    if (!ts) return '—';
    var diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    return T.fmtDate(ts);
  };
  T.fmtBytes = function (n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };
  T.fmtDuration = function (ms) {
    if (!ms || ms < 0) ms = 0;
    var s = Math.round(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + ss + ' 秒';
    return ss + ' 秒';
  };
  T.sanitizeFileName = function (name) {
    return String(name || '').replace(/[/\\?%*:|"'<>\x00-\x1f]/g, '-').trim().slice(0, 40) || 'untitled';
  };
  T.timeStamp = function () {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  };
})();
