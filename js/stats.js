/* =====================================================================
   stats.js —— 统计系统
   统计口径：
     已答题数  = 有答题记录的题目数（去重）
     答对/答错 = 每题"最近一次"作答的结果（正确 + 错误 = 已答题数）
     正确率    = 最近一次答对的题目数 / 已答题数
     尝试次数  = 全部答题记录条数（同一题重做会累计）
   所有统计基于 IndexedDB 中的真实数据实时计算。
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  function aggRecords(records) {
    var map = new Map();
    var attempts = 0, correctAttempts = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      attempts++;
      if (r.correct) correctAttempts++;
      var a = map.get(r.questionId);
      if (!a) {
        a = { attempts: 0, correct: 0, lastAt: 0, lastCorrect: false };
        map.set(r.questionId, a);
      }
      a.attempts++;
      if (r.correct) a.correct++;
      if ((r.answeredAt || 0) >= a.lastAt) {
        a.lastAt = r.answeredAt || 0;
        a.lastCorrect = !!r.correct;
      }
    }
    return { map: map, attempts: attempts, correctAttempts: correctAttempts };
  }

  function summarize(agg) {
    var answered = 0, correct = 0;
    agg.map.forEach(function (a) {
      answered++;
      if (a.lastCorrect) correct++;
    });
    return {
      answered: answered,
      correct: correct,
      wrong: answered - correct,
      accuracy: answered ? correct / answered : null,
      attempts: agg.attempts,
      attemptAccuracy: agg.attempts ? agg.correctAttempts / agg.attempts : null
    };
  }

  T.stats = {
    /* 全局统计（文件夹/题集/题目仅统计用户自建内容；
       答题记录、错题、收藏包含用户在内置公共题库上的练习） */
    global: function () {
      return Promise.all([
        T.db.count('folders'),
        T.db.count('sets'),
        T.db.count('questions'),
        T.db.countByIndex('folders', 'by-origin', 'public'),
        T.db.countByIndex('sets', 'by-origin', 'public'),
        T.db.countByIndex('questions', 'by-origin', 'public'),
        T.db.count('mistakes'),
        T.db.count('favorites'),
        T.db.getAll('records')
      ]).then(function (r) {
        var agg = aggRecords(r[8]);
        var s = summarize(agg);
        s.folders = Math.max(0, r[0] - r[3]);
        s.sets = Math.max(0, r[1] - r[4]);
        s.questions = Math.max(0, r[2] - r[5]);
        s.mistakes = r[6]; s.favorites = r[7];
        return s;
      });
    },

    /* 文件夹统计 */
    folderStats: function (folderId) {
      return Promise.all([
        T.db.countByIndex('sets', 'by-folder', folderId),
        T.db.countByIndex('questions', 'by-folder', folderId),
        T.db.countByIndex('mistakes', 'by-folder', folderId),
        T.db.countByIndex('favorites', 'by-folder', folderId),
        T.db.getAllByIndex('records', 'by-folder', folderId)
      ]).then(function (r) {
        var agg = aggRecords(r[4]);
        var s = summarize(agg);
        s.sets = r[0]; s.questions = r[1]; s.mistakes = r[2]; s.favorites = r[3];
        return s;
      });
    },

    /* 题集统计（含每题答题次数 / 正确次数） */
    setStats: function (setId) {
      return Promise.all([
        T.db.countByIndex('questions', 'by-set', setId),
        T.db.countByIndex('mistakes', 'by-set', setId),
        T.db.countByIndex('favorites', 'by-set', setId),
        T.db.getAllByIndex('records', 'by-set', setId)
      ]).then(function (r) {
        var agg = aggRecords(r[3]);
        var s = summarize(agg);
        s.questions = r[0]; s.mistakes = r[1]; s.favorites = r[2];
        s.perQuestion = agg.map;
        return s;
      });
    }
  };
})();
