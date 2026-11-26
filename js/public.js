/* =====================================================================
   public.js —— 内置公共题库（仓库内置题库）
   原理：仓库根目录下的 question-banks/<科目>/<题集>.json 是公共题库文件；
         GitHub Action（或手动维护）会生成 question-banks/manifest.json 清单。
   应用启动进入首页时：
     1. 拉取 manifest.json（失败时回退到上次缓存的清单或本地已同步的目录）；
     2. 按清单在 IndexedDB 中建立 origin='public' 的文件夹/题集记录（结构同步）；
     3. 题目内容按需下载：用户第一次打开某个公共题集时才下载该文件并缓存，
        清单题量变化或手动刷新时重新下载；
     4. 公共题集可正常刷题/进错题本/收藏，答题记录属于用户自己的数据。
   备份导出不包含公共题库本身（可随时重新下载），但包含用户在公共题库上的
   答题记录、错题、收藏与进度。
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  var MANIFEST_KEY = 'tiku-public-manifest';   /* localStorage 缓存键 */
  var SYNC_TTL = 5 * 60 * 1000;                /* 同一页面会话内 5 分钟内不重复拉取 */
  var lastSync = null;                         /* { at, result } */

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
  function fileUrl(path) {
    try { return new URL(encodeURI(path), document.baseURI).href; }
    catch (e) { return encodeURI(path); }
  }

  function validManifest(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.folders)) return false;
    for (var i = 0; i < m.folders.length; i++) {
      var f = m.folders[i];
      if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !f.name.trim()) return false;
      if (!Array.isArray(f.sets)) return false;
      for (var j = 0; j < f.sets.length; j++) {
        var s = f.sets[j];
        if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim()) return false;
        if (typeof s.file !== 'string' || !s.file.trim()) return false;
      }
    }
    return true;
  }

  function readCachedManifest() {
    try {
      var raw = localStorage.getItem(MANIFEST_KEY);
      if (!raw) return null;
      var m = JSON.parse(raw);
      return validManifest(m) ? m : null;
    } catch (e) { return null; }
  }
  function writeCachedManifest(m) {
    try { localStorage.setItem(MANIFEST_KEY, JSON.stringify(m)); } catch (e) { /* 忽略容量错误 */ }
  }

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

  /* ---------- 目录结构同步：manifest → IndexedDB（folders / sets） ---------- */
  function syncStructures(manifest) {
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

      manifest.folders.forEach(function (mf) {
        var folder = folderByKey.get(mf.name);
        if (!folder) {
          folder = { id: T.uuid(), name: mf.name, createdAt: now, origin: 'public', publicKey: mf.name };
          toPut.push({ store: 'folders', v: folder });
        }
        var sets = [];
        (mf.sets || []).forEach(function (ms) {
          var file = String(ms.file).replace(/^\.?\//, '');
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
      /* 分仓库批量写入（结构同步只涉及 folders 与 sets） */
      ['folders', 'sets'].forEach(function (store) {
        var items = toPut.filter(function (x) { return x.store === store; }).map(function (x) { return x.v; });
        if (items.length) p = p.then(function () { return T.db.bulkPut(store, items); });
      });
      return p.then(function () { return structure; });
    });
  }

  /* 无 manifest 时（离线且从未缓存）用本地已有公共目录兜底展示 */
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

  /* ---------- 对外：同步（首页每次进入调用；带页面会话级缓存） ---------- */
  T.public = {
    sync: function (force) {
      if (!force && lastSync && (Date.now() - lastSync.at) < SYNC_TTL) {
        return Promise.resolve(lastSync.result);
      }
      var self = this;
      return fetchJson(manifestUrl()).then(function (text) {
        var m;
        try { m = JSON.parse(text); } catch (e) { m = null; }
        if (!validManifest(m)) {
          /* 清单文件存在但格式不对：视为未配置 */
          var res = { ok: false, reason: 'invalid' };
          lastSync = { at: Date.now(), result: res };
          return res;
        }
        writeCachedManifest(m);
        return syncStructures(m).then(function (structure) {
          var res = { ok: true, stale: false, generatedAt: m.generatedAt || null, structure: structure };
          lastSync = { at: Date.now(), result: res };
          return res;
        });
      }).catch(function (err) {
        if (err && err.status === 404) {
          /* 站点没有配置公共题库（或尚未生成清单） */
          var res404 = { ok: false, reason: 'none' };
          lastSync = { at: Date.now(), result: res404 };
          return res404;
        }
        /* 网络失败：回退上次缓存清单；再不行回退本地目录 */
        var cached = readCachedManifest();
        if (cached) {
          return syncStructures(cached).then(function (structure) {
            var res = { ok: true, stale: true, generatedAt: cached.generatedAt || null, structure: structure };
            lastSync = { at: Date.now(), result: res };
            return res;
          });
        }
        return structureFromDb().then(function (structure) {
          var res = structure.length
            ? { ok: true, stale: true, generatedAt: null, structure: structure, offline: true }
            : { ok: false, reason: 'offline' };
          lastSync = { at: Date.now(), result: res };
          return res;
        });
      });
    },

    /* 题集内容按需下载/更新（force=true 强制重新下载） */
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
          return fetchJson(fileUrl(set.publicFile)).then(function (text) {
            var parsed = T.parseJSONBank(text, set.name);
            if (!parsed.ok) return { ok: false, error: parsed.error };
            return T.db.getAllByIndex('questions', 'by-set', set.id).then(function (oldQs) {
              var sid = set.id;
              var newQs = parsed.questions.map(function (q, i) {
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
            var msg = (e && e.status) ? ('HTTP ' + e.status) : (e && e.message) || '网络错误';
            return { ok: false, error: '下载内置题库文件失败（' + msg + '），请检查网络后重试' };
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

    /* 手动刷新某个公共题集（题集详情页“同步更新”按钮） */
    refreshSet: function (setId) {
      return T.db.get('sets', setId).then(function (set) {
        if (!set || set.origin !== 'public') return { ok: false, error: '不是公共题集' };
        return T.public.ensureSetLoaded(set, true);
      });
    }
  };
})();
