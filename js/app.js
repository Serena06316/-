/* =====================================================================
   app.js —— 应用入口：路由、顶部导航、数据库初始化
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  T._routeToken = 0;
  T.rerender = function () { route(); };
  T.go = function (hash) {
    if (window.location.hash === hash) route();
    else window.location.hash = hash;
  };

  var ROUTES = [
    [/^#\/folder\/([A-Za-z0-9-]+)$/, function (m) { return { fn: T.views.folder, args: [m[1]] }; }],
    [/^#\/set\/([A-Za-z0-9-]+)$/, function (m) { return { fn: T.views.setDetail, args: [m[1]] }; }],
    [/^#\/quiz\/([A-Za-z0-9-]+)$/, function (m) { return { fn: T.views.quiz, args: [m[1]] }; }],
    [/^#\/mistakes$/, function () { return { fn: T.views.mistakes, args: [] }; }],
    [/^#\/favorites$/, function () { return { fn: T.views.favorites, args: [] }; }],
    [/^#\/data$/, function () { return { fn: T.views.data, args: [] }; }],
    [/^#\/help$/, function () { return { fn: T.views.help, args: [] }; }]
  ];

  function matchRoute() {
    var h = window.location.hash || '#/';
    for (var i = 0; i < ROUTES.length; i++) {
      var m = h.match(ROUTES[i][0]);
      if (m) return ROUTES[i][1](m);
    }
    return { fn: T.views.home, args: [] };
  }

  async function route() {
    var view = document.getElementById('view');
    if (!view) return;
    T.runCleanups();
    view.replaceChildren(T.el('div', { class: 'page-loading' }, T.icon('refresh'), ' 加载中…'));
    var token = ++T._routeToken;
    var r = matchRoute();
    try {
      var node = await r.fn.apply(null, r.args);
      if (token !== T._routeToken) return; /* 已被新路由覆盖 */
      view.replaceChildren(node || T.el('div'));
      try { window.scrollTo({ top: 0 }); } catch (e) { window.scrollTo(0, 0); }
    } catch (e) {
      console.error(e);
      if (token !== T._routeToken) return;
      view.replaceChildren(T.el('div', { class: 'card empty-state' },
        T.icon('alertCircle', 'icon-lg'),
        el_h2('页面加载失败'),
        T.el('p', {}, '错误信息：' + (e.message || e)),
        T.el('button', { class: 'btn btn-primary', onClick: function () { T.go('#/'); } }, '返回首页')));
    }
    updateBadges();
  }
  function el_h2(text) { return T.el('h2', {}, text); }

  /* ---------- 顶部导航 ---------- */
  var badgeEls = {};
  var themeBtn = T.el('button', {
    class: 'icon-btn', 'aria-label': '切换日间/夜间主题', title: '切换日间/夜间主题',
    onClick: function () { T.toggleTheme(); }
  });
  function refreshThemeBtn() {
    var dark = document.documentElement.dataset.theme === 'dark';
    themeBtn.replaceChildren(T.icon(dark ? 'sun' : 'moon'));
    themeBtn.title = dark ? '切换到日间主题' : '切换到夜间主题';
  }
  T.refreshThemeIcon = refreshThemeBtn;

  function navBtn(icon, label, hash, badgeKey) {
    var badge = T.el('span', { class: 'nav-badge', hidden: true }, '0');
    if (badgeKey) badgeEls[badgeKey] = badge;
    return T.el('a', { class: 'icon-btn', href: hash, 'aria-label': label, title: label },
      T.icon(icon), badge);
  }

  function buildHeader() {
    var brandIcon = document.getElementById('brand-icon');
    if (brandIcon) brandIcon.replaceChildren(T.icon('book'));
    var nav = document.getElementById('top-nav');
    if (!nav) return;
    nav.append(
      navBtn('xCircle', '错题本', '#/mistakes', 'mistakes'),
      navBtn('star', '收藏夹', '#/favorites', 'favorites'),
      navBtn('database', '备份与数据管理', '#/data', null),
      navBtn('helpCircle', '使用说明', '#/help', null),
      themeBtn
    );
    refreshThemeBtn();
    /* 未手动设置过主题时，跟随系统切换 */
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function (e) {
        var saved = null;
        try { saved = localStorage.getItem('tiku-theme'); } catch (err) { /* 忽略 */ }
        if (saved !== 'light' && saved !== 'dark') {
          document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
          refreshThemeBtn();
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    } catch (e) { /* 忽略 */ }
  }

  function updateBadges() {
    if (!badgeEls.mistakes) return;
    Promise.all([T.db.count('mistakes'), T.db.count('favorites')]).then(function (r) {
      function set(badge, n) {
        if (!badge) return;
        if (n > 0) {
          badge.hidden = false;
          badge.textContent = n > 999 ? '999+' : String(n);
        } else {
          badge.hidden = true;
        }
      }
      set(badgeEls.mistakes, r[0]);
      set(badgeEls.favorites, r[1]);
    }).catch(function () { /* 忽略 */ });
  }

  /* ---------- 数据库初始化失败提示 ---------- */
  function fatalNode(err) {
    return T.el('div', { class: 'card empty-state', style: 'max-width:560px;margin:40px auto' },
      T.icon('alertCircle', 'icon-lg'),
      T.el('h2', {}, '本地数据库初始化失败'),
      T.el('p', {}, '错误信息：' + (err && err.message ? err.message : err)),
      T.el('p', { style: 'color:var(--muted);font-size:13.5px' },
        '可能的原因：浏览器处于无痕/隐私模式；浏览器禁止了站点存储；或数据库被占用。' +
        '请尝试：关闭无痕模式、在浏览器设置中允许本站点使用存储，然后重试。'),
      T.el('button', { class: 'btn btn-primary', onClick: function () { window.location.reload(); } }, T.icon('refresh'), '重试'));
  }

  /* ---------- 启动 ---------- */
  function boot() {
    T.initTheme();
    buildHeader();
    window.addEventListener('hashchange', route);
    T.db.open().then(function () {
      route();
    }).catch(function (e) {
      console.error(e);
      var view = document.getElementById('view');
      if (view) view.replaceChildren(fatalNode(e));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
