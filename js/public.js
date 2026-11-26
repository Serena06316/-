/* =====================================================================
   public.js —— 内置公共题库（仓库内置题库）
   原理：仓库根目录下的 question-banks/<科目>/<题集>.json|txt|csv|docx
         是公共题库文件，所有访客可见。
   目录发现（二选一，自动选择）：
     1. 优先读取 question-banks/manifest.json 清单文件（可用 GitHub Action
        自动维护，见 .github/workflows/update-banks.yml；也可手动维护）；
     2. 没有清单文件时，自动调用 GitHub 接口扫描仓库
        question-banks/ 目录下的题库文件（无需维护清单，放进文件即可）。
        仅在 *.github.io 域名下可自动识别仓库；自定义域名部署时请在下方
        REPO_OVERRIDE 填 "用户名/仓库名"。
   应用行为：
     1. 首页进入时同步目录（5 分钟内不重复拉取；可点「刷新」强制）；
     2. 按清单在 IndexedDB 中建立 origin='public' 的文件夹/题集记录；
     3. 题目内容按需下载：第一次打开某个公共题集时才下载该文件并缓存；
     4. 公共题集可正常刷题/进错题本/收藏，答题记录属于用户自己的数据；
     5. 仓库里删除/改名的文件，访问者端会话同步时自动清理对应题集。
   备份导出不包含公共题库本身（可随时重新下载），但包含用户在公共题库上的
   答题记录、错题、收藏与进度。
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  /* 维护者可选：使用自定义域名（非 *.github.io）部署时，GitHub 接口无法自动
     识别仓库，可在此填写 "用户名/仓库名"，例如 'Serena06316/tiku'。
     部署在 https://<用户名>.github.io/<仓库名>/ 下时无需填写。 */
  var REPO_OVERRIDE = '';

  var MANIFEST_KEY = 'tiku-public-manifest';   /* localStorage：最近一次成功的清单 */
  var API_KEY = 'tiku-public-api';             /* localStorage：最近一次接口扫描结果 */
  var API_TTL = 10 * 60 * 1000;                /* 接口扫描结果 10 分钟内复用（节省调用次数） */
  var SYNC_TTL = 5 * 60 * 1000;                /* 同一页面会话内 5 分钟内不重复拉取 */
  var lastSync = null;                         /* { at, result } */

  var BANK_RE = /^question-banks\/.+\.(json|txt|csv|docx)$/i;

  /* 由文件路径生成稳定的题集 ID（同一文件在所有用户/设备上 ID 一致） */
  function pathHash(p) {
    var h = 5381;
    for (var i = 0; i < p.length; i++) h = (((h << 5) + h) + p.charCodeAt(i)) >>> 0;
    return 'pub-' + h.toString(16);
  }

  function manifestUrl() {
    try { return new URL('question-banks/manifest.json', document.baseURI).href; }
    catch (e) { return 'question-banks/manifest.json'; }
  }
  /* 路径统一为「相对站点根目录」的完整路径（带 question-banks/ 前缀） */
  function normalizeFilePath(p) {
    p = String(p == null ? '' : p).trim().replace(/\\/g, '/');
    p = p.replace(/^\.?\//, '');
    if (!p) return '';
    if (!/^question-banks\//i.test(p)) p = 'question-banks/' + p;
    return p;
  }
  function encodePath(p) {
    if (p.indexOf('%') >= 0) return p; /* 已包含编码字符：按已编码处理 */
    return p.split('/').map(encodeURIComponent).join('/');
  }
  function fileUrl(path) {
    try { return new URL(encodePath(path), document.baseURI).href; }
    catch (e) { return encodePath(path); }
  }
  function prettyUrl(url) {
    try { return decodeURIComponent(url); } catch (e) { return url; }
  }
  function extOf(p) {
    var m = /\.([a-z0-9]+)$/i.exec(String(p || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /* ---------------- 通用抓取 ---------------- */
  function fetchJson(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) {
          var err = new Error('HTTP ' + resp.status);
          err.status = resp.status;
          throw err;
        }
        return resp.text();
      });
  }
  function fetchBuf(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) {
          var err = new Error('HTTP ' + resp.status);
          err.status = resp.status;
          throw err;
        }
        return resp.arrayBuffer();
      });
  }
  function fetchWithTimeout(url, ms) {
    var opts = { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } };
    if (typeof AbortController !== 'undefined') {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, ms || 9000);
      opts.signal = ctrl.signal;
      return fetch(url, opts).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r;
      }, function (e) { clearTimeout(timer); throw e; });
    }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) { var e2 = new Error('HTTP ' + r.status); e2.status = r.status; throw e2; }
      return r;
    });
  }

  /* ---------------- 清单读取与校验 ---------------- */
  function validManifest(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.folders)) return false;
    for (var i = 0; i < m.folders.length; i++) {
      var f = m.folders[i];
      if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !f.name.trim()) return false;
      if (f.sets != null && !Array.isArray(f.sets)) return false;
      var sets = Array.isArray(f.sets) ? f.sets : [];
      for (var j = 0; j < sets.length; j++) {
        var s = sets[j];
        if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim()) return false;
        if (typeof s.file !== 'string' || !s.file.trim()) return false;
      }
    }
    return true;
  }
  function manifestHasBanks(m) {
    return !!(m && Array.isArray(m.folders) && m.folders.some(function (f) {
      return Array.isArray(f.sets) && f.sets.length;
    }));
  }

  function readCached(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var m = JSON.parse(raw);
      return m && validManifest(m) ? m : null;
    } catch (e) { return null; }
  }
  function writeCached(key, m) {
    try { localStorage.setItem(key, JSON.stringify(m)); } catch (e) { /* 忽略容量错误 */ }
  }
  function readApiCache() {
    try {
      var raw = localStorage.getItem(API_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.manifest || !validManifest(o.manifest)) return null;
      return o; /* { at, manifest } */
    } catch (e) { return null; }
  }

  /* ---------------- GitHub 接口自动发现 ---------------- */
  /* 从 https://<用户名>.github.io/<仓库名>/ 形式的地址识别 owner/repo */
  function detectRepo() {
    if (REPO_OVERRIDE) return REPO_OVERRIDE;
    try {
      var host = location.hostname || '';
      var m = /^([a-z0-9-]+)\.github\.io$/i.exec(host);
      if (!m) return null; /* 自定义域名无法自动识别 */
      var owner = m[1];
      var seg = (location.pathname || '/').replace(/^\/+/, '').split('/')[0];
      if (!seg || /^index\.html?$/i.test(seg)) return owner + '/' + owner + '.github.io';
      return owner + '/' + seg;
    } catch (e) { return null; }
  }

  function manifestFromTree(tree) {
    var nodes = (tree || []).filter(function (n) {
      return n && n.type === 'blob' && BANK_RE.test(String(n.path || ''));
    });
    nodes.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    var byName = {}, order = [], seen = {};
    nodes.forEach(function (n) {
      var file = normalizeFilePath(n.path);
      if (!file || seen[file]) return;
      seen[file] = 1;
      if (/^question-banks\/manifest\.json$/i.test(file)) return; /* 清单本身不是题库 */
      var base = file.replace(/^question-banks\//i, '');
      var segs = base.split('/');
      var stem = segs[segs.length - 1].replace(/\.[^.]+$/, '');
      if (!stem || /^readme$/i.test(stem)) return; /* 忽略 README */
      var subject = segs.length >= 2 ? segs[0] : '未分类';
      if (!byName[subject]) { byName[subject] = { name: subject, sets: [] }; order.push(subject); }
      byName[subject].sets.push({ name: stem, file: file });
    });
    return { app: 'tiku-public', generatedAt: Date.now(), discovered: true, folders: order.map(function (k) { return byName[k]; }) };
  }

  function discoverViaApi() {
    var repo = detectRepo();
    if (!repo) return Promise.resolve({ reason: 'no-repo' });
    var cached = readApiCache();
    if (cached && (Date.now() - cached.at) < API_TTL && manifestHasBanks(cached.manifest)) {
      return Promise.resolve({ manifest: cached.manifest, fromCache: true });
    }
    var branches = ['main', 'master'];
    var i = 0;
    function attempt() {
      if (i >= branches.length) return Promise.resolve({ reason: 'api-failed' });
      var b = branches[i++];
      return fetchWithTimeout('https://api.github.com/repos/' + repo + '/git/trees/' + b + '?recursive=1', 9000)
        .then(function (resp) { return resp.json(); })
        .then(function (data) {
          if (!data || !Array.isArray(data.tree)) return attempt(); /* 分支异常：换下一个分支 */
          var m = manifestFromTree(data.tree);
          if (data.truncated) { /* 仓库过大导致列表被截断：结果可能不全，仍尽力展示 */ }
          return { manifest: m };
        })
        .catch(function (err) {
          if (err && err.status === 403) return Promise.resolve({ reason: 'api-limited' }); /* 接口调用受限：不重试 */
          return attempt(); /* 404（分支不存在）或网络错误：尝试下一个分支 */
        });
    }
    return attempt().then(function (res) {
      if (res && res.manifest) {
        writeCached(API_KEY, { at: Date.now(), manifest: res.manifest });
      }
      return res;
    });
  }

  /* ---------------- 目录结构同步：清单 → IndexedDB ---------------- */
  function syncStructures(manifest, fresh) {
    return Promise.all([
      T.db.getAllByIndex('folders', 'by-origin', 'public'),
      T.db.getAllByIndex('sets', 'by-origin', 'public')
    ]).then(function (r) {
      var folderByKey = new Map();   /* manifest 文件夹名 → folder 记录 */
      r[0].forEach(function (f) { folderByKey.set(f.publicKey || f.name, f); });
      var setByFile = new Map();     /* 文件路径 → set 记录 */
      r[1].forEach(function (s) { if (s.publicFile) setByFile.set(s.publicFile, s); });

      var now = Date.now();
      var toPut = [];
      var structure = [];
      var seenFiles = {};

      manifest.folders.forEach(function (mf) {
        var folder = folderByKey.get(mf.name);
        if (!folder) {
          folder = { id: T.uuid(), name: mf.name, createdAt: now, origin: 'public', publicKey: mf.name };
          toPut.push({ store: 'folders', v: folder });
        }
        var sets = [];
        (Array.isArray(mf.sets) ? mf.sets : []).forEach(function (ms) {
          var file = normalizeFilePath(ms.file);
          if (!file || seenFiles[file]) return;
          seenFiles[file] = 1;
          var set = setByFile.get(file);
          var count = typeof ms.count === 'number' && ms.count >= 0 ? ms.count : null;
          if (!set) {
            set = {
              id: pathHash(file),
              folderId: folder.id,
              name: ms.name,
              createdAt: now,
              sourceName: '内置公共题库 · ' + file,
              origin: 'public',
              publicFile: file,
              publicCount: count,
              publicStale: false,
              publicError: ms.error || null
            };
            toPut.push({ store: 'sets', v: set });
          } else {
            var changed = false;
            if (set.name !== ms.name) { set.name = ms.name; changed = true; }
            if (set.folderId !== folder.id) { set.folderId = folder.id; changed = true; }
            if (set.publicCount !== count) { set.publicCount = count; set.publicStale = true; changed = true; }
            if (set.publicError !== (ms.error || null)) { set.publicError = ms.error || null; changed = true; }
            if (changed) toPut.push({ store: 'sets', v: set });
          }
          sets.push(set);
        });
        structure.push({ record: folder, sets: sets });
      });

      var p = Promise.resolve();
      ['folders', 'sets'].forEach(function (store) {
        var items = toPut.filter(function (x) { return x.store === store; }).map(function (x) { return x.v; });
        if (items.length) p = p.then(function () { return T.db.bulkPut(store, items); });
      });
      return p.then(function () {
        if (fresh) return cleanupStale(structure);
        return structure;
      });
    });
  }

  /* 清理仓库中已不存在的公共题库（仅在有最新目录时执行） */
  function cleanupStale(structure) {
    var keepFolders = new Set(), keepSets = new Set();
    structure.forEach(function (f) {
      keepFolders.add(f.record.id);
      f.sets.forEach(function (s) { keepSets.add(s.id); });
    });
    return Promise.all([
      T.db.getAllByIndex('folders', 'by-origin', 'public'),
      T.db.getAllByIndex('sets', 'by-origin', 'public')
    ]).then(function (r) {
      var deadFolderIds = r[0].filter(function (f) { return !keepFolders.has(f.id); }).map(function (f) { return f.id; });
      var deadSets = r[1].filter(function (s) { return !keepSets.has(s.id); });
      if (!deadFolderIds.length && !deadSets.length) return structure;
      var deadSetIds = new Set(deadSets.map(function (s) { return s.id; }));
      deadFolderIds.forEach(function (fid) { deadSetIds.add(fid); }); /* 文件夹级会话一并清理 */
      return Promise.all([
        Promise.all(deadSets.map(function (s) { return T.db.getAllByIndex('questions', 'by-set', s.id); })),
        Promise.all(deadSets.map(function (s) { return T.db.getAllByIndex('records', 'by-set', s.id); })),
        Promise.all(deadSets.map(function (s) { return T.db.getAllByIndex('mistakes', 'by-set', s.id); })),
        Promise.all(deadSets.map(function (s) { return T.db.getAllByIndex('favorites', 'by-set', s.id); })),
        T.db.getAll('sessions')
      ]).then(function (rr) {
        var qIds = new Set();
        rr[0].forEach(function (list) { list.forEach(function (q) { qIds.add(q.id); }); });
        var deadSessions = rr[4].filter(function (ss) {
          if (ss.scope && deadSetIds.has(ss.scope.targetId)) return true;
          return (ss.questionIds || []).some(function (id) { return qIds.has(id); });
        }).map(function (ss) { return ss.id; });
        return T.db.run(T.db.stores, 'readwrite', function (t) {
          deadFolderIds.forEach(function (id) { t.objectStore('folders').delete(id); });
          deadSets.forEach(function (s, di) {
            t.objectStore('sets').delete(s.id);
            (rr[0][di] || []).forEach(function (q) { t.objectStore('questions').delete(q.id); });
          });
          rr[1].forEach(function (list) { list.forEach(function (rec) { t.objectStore('records').delete(rec.id); }); });
          rr[2].forEach(function (list) { list.forEach(function (m) { t.objectStore('mistakes').delete(m.questionId); }); });
          rr[3].forEach(function (list) { list.forEach(function (f) { t.objectStore('favorites').delete(f.questionId); }); });
          deadSessions.forEach(function (id) { t.objectStore('sessions').delete(id); });
        }).then(function () { return structure; });
      });
    });
  }

  /* 无 manifest 且接口不可用时，用本地已有公共目录兜底展示 */
  function structureFromDb() {
    return Promise.all([
      T.db.getAllByIndex('folders', 'by-origin', 'public'),
      T.db.getAllByIndex('sets', 'by-origin', 'public')
    ]).then(function (r) {
      var folders = r[0].slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var setsByFolder = new Map();
      r[1].forEach(function (s) {
        if (!setsByFolder.has(s.folderId)) setsByFolder.set(s.folderId, []);
        setsByFolder.get(s.folderId).push(s);
      });
      setsByFolder.forEach(function (list) {
        list.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      });
      return folders.map(function (f) {
        return { record: f, sets: setsByFolder.get(f.id) || [] };
      });
    });
  }

  /* ---------------- 对外：同步（首页每次进入调用；带页面会话级缓存） ---------------- */
  T.public = {
    sync: function (force) {
      if (!force && lastSync && (Date.now() - lastSync.at) < SYNC_TTL) {
        return Promise.resolve(lastSync.result);
      }
      /* 1. 优先清单文件 */
      return fetchJson(manifestUrl()).then(function (text) {
        var m = null;
        try { m = JSON.parse(text); } catch (e) { m = null; }
        if (validManifest(m) && manifestHasBanks(m)) {
          writeCached(MANIFEST_KEY, m);
          return { via: 'manifest', manifest: m };
        }
        if (validManifest(m)) writeCached(MANIFEST_KEY, m); /* 空清单也缓存，但继续尝试接口 */
        return null;
      }).catch(function () {
        return null; /* 清单不存在（404）或网络失败：走接口自动发现 */
      }).then(function (mres) {
        if (mres) return mres;
        /* 2. 接口自动发现 */
        return discoverViaApi().then(function (ares) {
          if (ares && ares.manifest && manifestHasBanks(ares.manifest)) {
            return { via: 'api', manifest: ares.manifest };
          }
          if (ares && ares.manifest) return { via: 'api-empty', manifest: ares.manifest };
          return { via: 'none', reason: (ares && ares.reason) || 'api-failed' };
        });
      }).then(function (res) {
        if (res.via === 'manifest' || res.via === 'api') {
          return syncStructures(res.manifest, true).then(function (structure) {
            return finish({ ok: true, stale: false, structure: structure, source: res.via, generatedAt: res.manifest.generatedAt || null });
          });
        }
        /* 接口扫描成功但仓库确实没有题库：直接判定为未配置 */
        if (res.via === 'api-empty') {
          return finish({ ok: false, reason: 'none' });
        }
        /* 3. 接口没拿到（网络/受限/非 github.io 部署）：回退接口缓存 / 清单缓存 / 本地目录 */
        var cachedApi = readApiCache();
        if (cachedApi && manifestHasBanks(cachedApi.manifest)) {
          return syncStructures(cachedApi.manifest, false).then(function (structure) {
            return finish({ ok: true, stale: true, structure: structure, source: 'api-cache' });
          });
        }
        var cachedMan = readCached(MANIFEST_KEY);
        if (cachedMan && manifestHasBanks(cachedMan)) {
          return syncStructures(cachedMan, false).then(function (structure) {
            return finish({ ok: true, stale: true, structure: structure, source: 'manifest-cache' });
          });
        }
        return structureFromDb().then(function (structure) {
          if (structure.length) return finish({ ok: true, stale: true, offline: true, structure: structure, source: 'local' });
          return finish({ ok: false, reason: res.reason || 'offline' });
        });
      });
      function finish(result) {
        lastSync = { at: Date.now(), result: result };
        return result;
      }
    },

    /* ---------------- 题集内容按需下载/更新 ---------------- */
    _loading: {},
    ensureSetLoaded: function (set, force) {
      var self = this;
      if (!set || !set.publicFile) return Promise.resolve({ ok: false, error: '该题集不是公共题库' });
      if (this._loading[set.id]) return this._loading[set.id];

      var job = (function () {
        var need = force || set.publicStale;
        var pre = Promise.resolve(false);
        if (!need) {
          pre = T.db.countByIndex('questions', 'by-set', set.id).then(function (n) {
            return n === 0; /* 本地没有题目 → 需要下载 */
          });
        } else {
          pre = Promise.resolve(true);
        }
        return pre.then(function (mustFetch) {
          if (!mustFetch) return { ok: true, cached: true };
          var url = fileUrl(set.publicFile);
          var ext = extOf(set.publicFile);
          var parsed;
          if (ext === 'docx') {
            parsed = fetchBuf(url).then(function (buf) { return T.parseDOCXBank(buf, set.name); });
          } else {
            parsed = fetchJson(url).then(function (text) {
              if (ext === 'txt') return T.parseTXTBank(text, set.name);
              if (ext === 'csv') return T.parseCSVBank(text, set.name);
              return T.parseJSONBank(text, set.name);
            });
          }
          return parsed.then(function (result) {
            if (!result.ok) return { ok: false, error: result.error };
            return T.db.getAllByIndex('questions', 'by-set', set.id).then(function (oldQs) {
              var sid = set.id;
              var newQs = result.questions.map(function (q, i) {
                return {
                  id: sid + '::' + (q.rawId != null ? q.rawId : ('q' + (i + 1))),
                  setId: sid, folderId: set.folderId,
                  type: q.type, question: q.question, options: q.options, answer: q.answer,
                  explanation: q.explanation || '', chapter: q.chapter || '',
                  order: i, origin: 'public'
                };
              });
              return T.db.run(['questions', 'sets'], 'readwrite', function (t) {
                var os = t.objectStore('questions');
                oldQs.forEach(function (q) { os.delete(q.id); });
                newQs.forEach(function (q) { os.put(q); });
              }).then(function () {
                set.publicStale = false;
                set.publicCount = newQs.length;
                set.publicError = null;
                set.publicFetchedAt = Date.now();
                return T.db.put('sets', set).then(function () {
                  return { ok: true, cached: false, count: newQs.length };
                });
              });
            });
          }).catch(function (e) {
            if (e && e.status === 404) {
              return {
                ok: false,
                error: '题库文件未找到（HTTP 404）：' + prettyUrl(url) +
                  '。请确认仓库中该文件已上传且路径一致；刚上传的文件 GitHub Pages 更新约需 1-2 分钟，稍后点「同步更新」重试'
              };
            }
            return { ok: false, error: '下载内置题库失败（' + ((e && e.message) || '网络错误') + '），请检查网络后重试' };
          });
        });
      })();
      self._loading[set.id] = job.then(function (r) {
        delete self._loading[set.id];
        return r;
      }, function (e) {
        delete self._loading[set.id];
        throw e;
      });
      return self._loading[set.id];
    },

    /* 手动刷新某个公共题集（题集详情页「同步更新」按钮） */
    refreshSet: function (setId) {
      return T.db.get('sets', setId).then(function (set) {
        if (!set || set.origin !== 'public') return { ok: false, error: '不是公共题集' };
        return T.public.ensureSetLoaded(set, true);
      });
    }
  };
})();
