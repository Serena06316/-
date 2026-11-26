/* =====================================================================
   db.js —— IndexedDB 封装（数据库结构、版本升级、事务与 CRUD）
   存储结构：
     folders   { id, name, createdAt }
     sets      { id, folderId, name, createdAt, sourceName }
     questions { id, setId, folderId, type, question, options[], answer[], explanation, chapter, order }
     records   { id(自增), questionId, setId, folderId, selected[], correct, answeredAt }
     mistakes  { questionId(主键), setId, folderId, addedAt, attempts, correctCount, lastAnsweredAt, mastered }
     favorites { questionId(主键), setId, folderId, addedAt }
     sessions  { id, scopeKey, scope{...}, questionIds[], currentIndex, answers{}, createdAt, updatedAt, done, originRoute }
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  var DB_NAME = 'tiku-db';
  var DB_VERSION = 1;
  var STORE_LIST = ['folders', 'sets', 'questions', 'records', 'mistakes', 'favorites', 'sessions'];

  function pwrap(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /* 数据库结构定义：[store, keyPath, autoIncrement, [ [索引名, 键路径], ... ]] */
  function createSchema(inst, oldVersion) {
    function mk(store, keyPath, autoIncrement, indexes) {
      var os = inst.createObjectStore(store, { keyPath: keyPath, autoIncrement: !!autoIncrement });
      (indexes || []).forEach(function (ix) { os.createIndex(ix[0], ix[1]); });
    }
    /* v1：初始结构。后续版本升级在此追加 if (oldVersion < 2) { ... } */
    if (oldVersion < 1) {
      mk('folders', 'id', false, [['by-created', 'createdAt'], ['by-name', 'name']]);
      mk('sets', 'id', false, [['by-folder', 'folderId'], ['by-created', 'createdAt']]);
      mk('questions', 'id', false, [['by-set', 'setId'], ['by-folder', 'folderId'], ['by-chapter', 'chapter']]);
      mk('records', 'id', true, [['by-question', 'questionId'], ['by-set', 'setId'], ['by-folder', 'folderId'], ['by-time', 'answeredAt']]);
      mk('mistakes', 'questionId', false, [['by-set', 'setId'], ['by-folder', 'folderId'], ['by-last', 'lastAnsweredAt']]);
      mk('favorites', 'questionId', false, [['by-set', 'setId'], ['by-folder', 'folderId'], ['by-added', 'addedAt']]);
      mk('sessions', 'id', false, [['by-scope', 'scopeKey'], ['by-updated', 'updatedAt']]);
    }
  }

  var db = {
    stores: STORE_LIST,
    _inst: null,
    _opening: null,

    open: function () {
      if (this._inst) return Promise.resolve(this._inst);
      if (this._opening) return this._opening;
      if (!('indexedDB' in window)) {
        return Promise.reject(new Error('当前浏览器不支持 IndexedDB，无法保存数据'));
      }
      this._opening = new Promise(function (resolve, reject) {
        var req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); }
        catch (e) { reject(e); return; }
        req.onupgradeneeded = function (e) {
          createSchema(req.result, e.oldVersion || 0);
        };
        req.onsuccess = function () {
          db._inst = req.result;
          req.result.onversionchange = function () {
            try { req.result.close(); } catch (e) { /* 忽略 */ }
            db._inst = null;
          };
          resolve(req.result);
        };
        req.onerror = function () { reject(req.error || new Error('数据库打开失败')); };
        req.onblocked = function () { reject(new Error('数据库正被其他标签页占用，请关闭本站的其他标签页后重试')); };
      });
      return this._opening;
    },

    _ensure: function () {
      if (!this._inst) throw new Error('数据库尚未初始化');
      return this._inst;
    },

    /* 事务运行器：fn 必须同步发起所有请求；事务完成后 resolve 其返回值 */
    run: function (storeNames, mode, fn) {
      var inst;
      try { inst = this._ensure(); } catch (e) { return Promise.reject(e); }
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = inst.transaction(storeNames, mode); }
        catch (e) { reject(e); return; }
        var result, failed = false;
        tx.onabort = function () { reject(tx.error || new Error('事务已中止')); };
        tx.oncomplete = function () { if (!failed) resolve(result); };
        try { result = fn(tx); }
        catch (e) { failed = true; reject(e); try { tx.abort(); } catch (e2) { /* 忽略 */ } }
      });
    },

    get: function (store, key) {
      return this.run([store], 'readonly', function (t) { return pwrap(t.objectStore(store).get(key)); });
    },
    getAll: function (store) {
      return this.run([store], 'readonly', function (t) { return pwrap(t.objectStore(store).getAll()); });
    },
    getMany: function (store, keys) {
      var self = this;
      var ps = this.run([store], 'readonly', function (t) {
        var os = t.objectStore(store);
        return keys.map(function (k) { return pwrap(os.get(k)); });
      });
      return ps.then(function (list) { return Promise.all(list); });
    },
    put: function (store, value) {
      return this.run([store], 'readwrite', function (t) { t.objectStore(store).put(value); });
    },
    bulkPut: function (store, values) {
      return this.run([store], 'readwrite', function (t) {
        var os = t.objectStore(store);
        for (var i = 0; i < values.length; i++) os.put(values[i]);
      });
    },
    delete: function (store, key) {
      return this.run([store], 'readwrite', function (t) { t.objectStore(store).delete(key); });
    },
    bulkDelete: function (store, keys) {
      return this.run([store], 'readwrite', function (t) {
        var os = t.objectStore(store);
        for (var i = 0; i < keys.length; i++) os.delete(keys[i]);
      });
    },
    clear: function (store) {
      return this.run([store], 'readwrite', function (t) { t.objectStore(store).clear(); });
    },
    count: function (store) {
      return this.run([store], 'readonly', function (t) { return pwrap(t.objectStore(store).count()); });
    },
    countByIndex: function (store, index, key) {
      return this.run([store], 'readonly', function (t) { return pwrap(t.objectStore(store).index(index).count(key)); });
    },
    getAllByIndex: function (store, index, key) {
      return this.run([store], 'readonly', function (t) {
        var ix = t.objectStore(store).index(index);
        return pwrap(key === undefined ? ix.getAll() : ix.getAll(key));
      });
    }
  };

  T.db = db;
})();
