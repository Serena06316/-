/* =====================================================================
   backup.js —— 数据备份与恢复
   备份文件格式：{ app:"tiku", schema:1, kind:"full"|"folder"|"set", exportedAt, data:{...7个仓库} }
   - full   ：完整备份，导入时替换全部数据（事务内清空后写入）
   - folder ：单个文件夹及其全部内容，导入时作为新文件夹添加（ID 全部重新映射）
   - set    ：单个题集，导入时选择目标文件夹后添加
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};
  var STORES = ['folders', 'sets', 'questions', 'records', 'mistakes', 'favorites', 'sessions'];

  function arr(v) { return Array.isArray(v) ? v : []; }

  function collectAll() {
    return Promise.all(STORES.map(function (s) { return T.db.getAll(s); })).then(function (list) {
      var data = {};
      STORES.forEach(function (s, i) { data[s] = list[i]; });
      /* 完整备份不包含内置公共题库本身（可随时从站点重新下载），
         但保留用户在公共题库上的答题记录 / 错题 / 收藏 / 进度 */
      ['folders', 'sets', 'questions'].forEach(function (s) {
        data[s] = (data[s] || []).filter(function (x) { return x.origin !== 'public'; });
      });
      return data;
    });
  }

  function uniqueName(existingNames, name) {
    if (existingNames.indexOf(name) < 0) return name;
    for (var i = 2; ; i++) {
      var cand = name + ' (' + i + ')';
      if (existingNames.indexOf(cand) < 0) return cand;
    }
  }

  T.backup = {
    /* ---------- 导出 ---------- */
    buildFull: function () {
      return collectAll().then(function (data) {
        return { app: 'tiku', schema: 1, kind: 'full', exportedAt: Date.now(), data: data };
      });
    },
    exportFull: function () {
      return T.backup.buildFull().then(function (obj) {
        T.download('tiku-完整备份-' + T.timeStamp() + '.json', JSON.stringify(obj));
        T.toast('完整备份已导出', 'success');
      }).catch(function (e) { T.toast('导出失败：' + (e.message || e), 'error'); });
    },

    buildFolder: function (folderId) {
      return T.db.get('folders', folderId).then(function (folder) {
        if (!folder) throw new Error('文件夹不存在');
        return Promise.all([
          T.db.getAllByIndex('sets', 'by-folder', folderId),
          T.db.getAllByIndex('questions', 'by-folder', folderId),
          T.db.getAllByIndex('records', 'by-folder', folderId),
          T.db.getAllByIndex('mistakes', 'by-folder', folderId),
          T.db.getAllByIndex('favorites', 'by-folder', folderId),
          T.db.getAll('sessions')
        ]).then(function (r) {
          var setIds = r[0].map(function (s) { return s.id; });
          var qIds = {};
          r[1].forEach(function (q) { qIds[q.id] = 1; });
          var sessions = r[5].filter(function (s) {
            if (s.scope && s.scope.targetId === folderId) return true;
            if (s.scope && s.scope.mode === 'set' && setIds.indexOf(s.scope.targetId) >= 0) return true;
            return (s.questionIds || []).some(function (id) { return qIds[id]; });
          });
          return {
            app: 'tiku', schema: 1, kind: 'folder', exportedAt: Date.now(),
            data: { folders: [folder], sets: r[0], questions: r[1], records: r[2], mistakes: r[3], favorites: r[4], sessions: sessions }
          };
        });
      });
    },
    exportFolder: function (folderId) {
      return T.backup.buildFolder(folderId).then(function (obj) {
        var name = obj.data.folders[0] ? obj.data.folders[0].name : '文件夹';
        T.download('tiku-文件夹-' + T.sanitizeFileName(name) + '-' + T.timeStamp() + '.json', JSON.stringify(obj));
        T.toast('文件夹备份已导出', 'success');
      }).catch(function (e) { T.toast('导出失败：' + (e.message || e), 'error'); });
    },

    buildSet: function (setId) {
      return T.db.get('sets', setId).then(function (set) {
        if (!set) throw new Error('题集不存在');
        return T.db.get('folders', set.folderId).then(function (folder) {
          return Promise.all([
            T.db.getAllByIndex('questions', 'by-set', setId),
            T.db.getAllByIndex('records', 'by-set', setId),
            T.db.getAllByIndex('mistakes', 'by-set', setId),
            T.db.getAllByIndex('favorites', 'by-set', setId),
            T.db.getAll('sessions')
          ]).then(function (r) {
            var qIds = {};
            r[0].forEach(function (q) { qIds[q.id] = 1; });
            var sessions = r[4].filter(function (s) {
              if (s.scope && s.scope.targetId === setId) return true;
              return (s.questionIds || []).some(function (id) { return qIds[id]; });
            });
            return {
              app: 'tiku', schema: 1, kind: 'set', exportedAt: Date.now(),
              data: {
                folders: folder ? [folder] : [],
                sets: [set], questions: r[0], records: r[1],
                mistakes: r[2], favorites: r[3], sessions: sessions
              }
            };
          });
        });
      });
    },
    exportSet: function (setId) {
      return T.backup.buildSet(setId).then(function (obj) {
        var name = obj.data.sets[0] ? obj.data.sets[0].name : '题集';
        T.download('tiku-题集-' + T.sanitizeFileName(name) + '-' + T.timeStamp() + '.json', JSON.stringify(obj));
        T.toast('题集备份已导出', 'success');
      }).catch(function (e) { T.toast('导出失败：' + (e.message || e), 'error'); });
    },

    /* ---------- 校验 ---------- */
    validateBackup: function (data) {
      if (!data || typeof data !== 'object') return { ok: false, error: '不是有效的备份 JSON' };
      if (data.app !== 'tiku') {
        return { ok: false, error: '这不是本地题库的备份文件。普通题库文件请进入文件夹后导入' };
      }
      var d = data.data || {};
      if (data.kind === 'full') {
        var counts = {
          folders: arr(d.folders).length, sets: arr(d.sets).length, questions: arr(d.questions).length,
          records: arr(d.records).length
        };
        var summary = counts.folders + ' 个文件夹、' + counts.sets + ' 个题集、' + counts.questions + ' 道题目、' + counts.records + ' 条答题记录';
        return { ok: true, kind: 'full', payload: data, counts: counts, summary: summary };
      }
      if (data.kind === 'folder') {
        if (!arr(d.folders).length) return { ok: false, error: '备份缺少文件夹数据' };
        return {
          ok: true, kind: 'folder', payload: data,
          name: arr(d.folders)[0].name || '导入文件夹',
          sets: arr(d.sets).length, questions: arr(d.questions).length
        };
      }
      if (data.kind === 'set') {
        if (!arr(d.sets).length) return { ok: false, error: '备份缺少题集数据' };
        return {
          ok: true, kind: 'set', payload: data,
          name: arr(d.sets)[0].name || '导入题集',
          questions: arr(d.questions).length
        };
      }
      return { ok: false, error: '未知的备份类型' };
    },

    /* ---------- 完整恢复（替换全部数据，调用前需用户确认） ---------- */
    restoreFull: function (payload) {
      var d = payload.data || {};
      var data = {};
      STORES.forEach(function (s) { data[s] = arr(d[s]); });
      return T.db.run(STORES, 'readwrite', function (t) {
        STORES.forEach(function (s) { t.objectStore(s).clear(); });
        STORES.forEach(function (s) {
          var os = t.objectStore(s);
          data[s].forEach(function (v) { os.put(v); });
        });
      }).then(function () {
        return {
          folders: data.folders.length, sets: data.sets.length,
          questions: data.questions.length, records: data.records.length,
          mistakes: data.mistakes.length, favorites: data.favorites.length
        };
      });
    },

    /* ---------- 导入文件夹备份（作为新文件夹，重映射全部 ID） ---------- */
    importFolder: function (payload) {
      var d = payload.data || {};
      var oldFolder = arr(d.folders)[0] || {};
      return T.db.getAll('folders').then(function (folders) {
        var nf = {
          id: T.uuid(),
          name: uniqueName(folders.map(function (f) { return f.name; }), String(oldFolder.name || '导入文件夹').trim() || '导入文件夹'),
          createdAt: Date.now()
        };
        var setMap = new Map(), qMap = new Map();
        var sets = arr(d.sets).map(function (s) {
          var nid = T.uuid();
          setMap.set(s.id, nid);
          return { id: nid, folderId: nf.id, name: s.name || '未命名题集', createdAt: s.createdAt || Date.now(), sourceName: s.sourceName || '' };
        });
        var questions = arr(d.questions).map(function (q) {
          var nid = T.uuid();
          qMap.set(q.id, nid);
          return {
            id: nid, setId: setMap.get(q.setId) || null, folderId: nf.id,
            type: q.type, question: q.question, options: q.options, answer: q.answer,
            explanation: q.explanation || '', chapter: q.chapter || '', order: q.order || 0
          };
        }).filter(function (q) { return q.setId && q.question; });
        function remapEntry(e) {
          return {
            questionId: qMap.get(e.questionId),
            setId: setMap.get(e.setId) || null,
            folderId: nf.id,
            addedAt: e.addedAt || Date.now(),
            answeredAt: e.answeredAt || Date.now(),
            selected: e.selected || [],
            correct: !!e.correct,
            attempts: e.attempts || 1,
            correctCount: e.correctCount || 0,
            lastAnsweredAt: e.lastAnsweredAt || e.answeredAt || Date.now(),
            mastered: !!e.mastered
          };
        }
        var records = arr(d.records).map(function (e) {
          var r = remapEntry(e);
          return { questionId: r.questionId, setId: r.setId, folderId: r.folderId, selected: r.selected, correct: r.correct, answeredAt: r.answeredAt };
        }).filter(function (r) { return r.questionId; });
        var mistakes = arr(d.mistakes).map(remapEntry).filter(function (e) { return e.questionId; });
        var favorites = arr(d.favorites).map(remapEntry).filter(function (e) { return e.questionId; });

        return T.db.run(STORES, 'readwrite', function (t) {
          t.objectStore('folders').put(nf);
          var os = t.objectStore('sets'); sets.forEach(function (v) { os.put(v); });
          var oq = t.objectStore('questions'); questions.forEach(function (v) { oq.put(v); });
          var or_ = t.objectStore('records'); records.forEach(function (v) { or_.put(v); });
          var om = t.objectStore('mistakes'); mistakes.forEach(function (v) { om.put(v); });
          var of_ = t.objectStore('favorites'); favorites.forEach(function (v) { of_.put(v); });
        }).then(function () {
          return { name: nf.name, sets: sets.length, questions: questions.length, records: records.length, mistakes: mistakes.length, favorites: favorites.length };
        });
      });
    },

    /* ---------- 导入题集备份（写入指定文件夹，重映射全部 ID） ---------- */
    importSet: function (payload, folderId) {
      var d = payload.data || {};
      var oldSet = arr(d.sets)[0] || {};
      return T.db.get('folders', folderId).then(function (folder) {
        if (!folder) throw new Error('目标文件夹不存在');
        return T.db.getAllByIndex('sets', 'by-folder', folderId).then(function (existingSets) {
          var ns = {
            id: T.uuid(),
            folderId: folderId,
            name: uniqueName(existingSets.map(function (s) { return s.name; }), String(oldSet.name || '导入题集').trim() || '导入题集'),
            createdAt: Date.now(),
            sourceName: oldSet.sourceName || ''
          };
          var qMap = new Map();
          var questions = arr(d.questions).map(function (q, i) {
            var nid = T.uuid();
            qMap.set(q.id, nid);
            return {
              id: nid, setId: ns.id, folderId: folderId,
              type: q.type, question: q.question, options: q.options, answer: q.answer,
              explanation: q.explanation || '', chapter: q.chapter || '', order: q.order != null ? q.order : i
            };
          }).filter(function (q) { return q.question; });
          function remapEntry(e) {
            return {
              questionId: qMap.get(e.questionId), setId: ns.id, folderId: folderId,
              addedAt: e.addedAt || Date.now(), answeredAt: e.answeredAt || Date.now(),
              selected: e.selected || [], correct: !!e.correct,
              attempts: e.attempts || 1, correctCount: e.correctCount || 0,
              lastAnsweredAt: e.lastAnsweredAt || e.answeredAt || Date.now(), mastered: !!e.mastered
            };
          }
          var records = arr(d.records).map(function (e) {
            var r = remapEntry(e);
            return { questionId: r.questionId, setId: r.setId, folderId: r.folderId, selected: r.selected, correct: r.correct, answeredAt: r.answeredAt };
          }).filter(function (r) { return r.questionId; });
          var mistakes = arr(d.mistakes).map(remapEntry).filter(function (e) { return e.questionId; });
          var favorites = arr(d.favorites).map(remapEntry).filter(function (e) { return e.questionId; });

          return T.db.run(STORES, 'readwrite', function (t) {
            t.objectStore('sets').put(ns);
            var oq = t.objectStore('questions'); questions.forEach(function (v) { oq.put(v); });
            var or_ = t.objectStore('records'); records.forEach(function (v) { or_.put(v); });
            var om = t.objectStore('mistakes'); mistakes.forEach(function (v) { om.put(v); });
            var of_ = t.objectStore('favorites'); favorites.forEach(function (v) { of_.put(v); });
          }).then(function () {
            return { name: ns.name, questions: questions.length, records: records.length, mistakes: mistakes.length, favorites: favorites.length };
          });
        });
      });
    },

    /* ---------- 清空全部数据 ---------- */
    clearAll: function () {
      return T.db.run(STORES, 'readwrite', function (t) {
        STORES.forEach(function (s) { t.objectStore(s).clear(); });
      });
    }
  };
})();
