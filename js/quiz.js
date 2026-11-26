/* =====================================================================
   quiz.js —— 刷题引擎与刷题页面
   功能：题集/文件夹/错题本/收藏/指定题目 五种刷题范围，
         顺序/随机、按题型/章节/仅错题/仅收藏/仅未答 筛选，
         单选/多选/判断判题、防重复提交、重做、答题卡、进度持久化与恢复
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};
  T.views = T.views || {};

  var TYPE_LABELS = { single: '单选题', multiple: '多选题', judge: '判断题' };

  /* ============ 题目收集（按范围与筛选条件） ============ */
  T.collectQuestions = function (cfg) {
    var mode = cfg.mode, targetId = cfg.targetId, filters = cfg.filters || {};
    var qs = [];

    var p = Promise.resolve();
    if (mode === 'set') {
      p = T.db.getAllByIndex('questions', 'by-set', targetId).then(function (list) {
        list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        return list;
      });
    } else if (mode === 'folder') {
      p = Promise.all([
        T.db.getAllByIndex('questions', 'by-folder', targetId),
        T.db.getAllByIndex('sets', 'by-folder', targetId)
      ]).then(function (r) {
        var orderMap = new Map();
        r[1].forEach(function (s) { orderMap.set(s.id, s.createdAt || 0); });
        r[0].sort(function (a, b) {
          return (orderMap.get(a.setId) || 0) - (orderMap.get(b.setId) || 0) || (a.order || 0) - (b.order || 0);
        });
        return r[0];
      });
    } else if (mode === 'mistakes' || mode === 'favorites') {
      p = T.db.getAll(mode).then(function (entries) {
        if (filters.folderId) entries = entries.filter(function (e) { return e.folderId === filters.folderId; });
        if (filters.setId) entries = entries.filter(function (e) { return e.setId === filters.setId; });
        if (mode === 'mistakes' && filters.status && filters.status !== 'all') {
          entries = entries.filter(function (e) { return filters.status === 'mastered' ? !!e.mastered : !e.mastered; });
        }
        entries.sort(function (a, b) {
          return (b.lastAnsweredAt || b.addedAt || 0) - (a.lastAnsweredAt || a.addedAt || 0);
        });
        return T.db.getMany('questions', entries.map(function (e) { return e.questionId; }));
      }).then(function (qList) { return qList.filter(Boolean); });
    } else if (mode === 'ids') {
      p = T.db.getMany('questions', cfg.questionIds || []).then(function (qList) { return qList.filter(Boolean); });
    }

    return p.then(function (list) {
      qs = list || [];
      if (mode === 'set' || mode === 'folder') {
        if (filters.types && filters.types.length) {
          qs = qs.filter(function (q) { return filters.types.indexOf(q.type) >= 0; });
        }
        if (filters.chapters && filters.chapters.length) {
          qs = qs.filter(function (q) { return filters.chapters.indexOf(q.chapter || '') >= 0; });
        }
        if (filters.onlyWrong || filters.onlyFav || filters.onlyUnanswered) {
          var idxName = mode === 'set' ? 'by-set' : 'by-folder';
          var chain = Promise.resolve(qs);
          if (filters.onlyWrong) {
            chain = chain.then(function (cur) {
              return T.db.getAllByIndex('mistakes', idxName, targetId).then(function (es) {
                var s = new Set(es.map(function (e) { return e.questionId; }));
                return cur.filter(function (q) { return s.has(q.id); });
              });
            });
          }
          if (filters.onlyFav) {
            chain = chain.then(function (cur) {
              return T.db.getAllByIndex('favorites', idxName, targetId).then(function (es) {
                var s = new Set(es.map(function (e) { return e.questionId; }));
                return cur.filter(function (q) { return s.has(q.id); });
              });
            });
          }
          if (filters.onlyUnanswered) {
            chain = chain.then(function (cur) {
              return T.db.getAllByIndex('records', idxName, targetId).then(function (rs) {
                var s = new Set(rs.map(function (r) { return r.questionId; }));
                return cur.filter(function (q) { return !s.has(q.id); });
              });
            });
          }
          return chain;
        }
      }
      return qs;
    });
  };

  /* ============ 判题 ============ */
  function grade(q, sel) {
    var a = q.answer.slice().sort().join('|');
    var s = Array.from(new Set(sel)).sort().join('|');
    return a === s;
  }

  /* ============ 启动刷题 ============ */
  T.startQuiz = function (cfg) {
    return T.collectQuestions(cfg).then(function (qs) {
      if (!qs.length) {
        T.toast('没有符合当前条件的题目', 'error');
        return null;
      }
      var order = cfg.order === 'random' ? 'random' : 'seq';
      var questionIds = qs.map(function (q) { return q.id; });
      var scopeKey = [cfg.mode, cfg.targetId || '', order, T.stableStringify(cfg.filters || {})].join('|');

      var pre = Promise.resolve({ pick: 'new', list: [] });
      if (cfg.mode !== 'ids') {
        pre = T.db.getAllByIndex('sessions', 'by-scope', scopeKey).then(function (list) {
          var resumable = list.filter(function (s) { return !s.done; })
            .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0] || null;
          if (!resumable) return { pick: 'new', list: list };
          var doneCount = Object.keys(resumable.answers || {}).length;
          return T.choice({
            title: '发现未完成的练习',
            message: '“' + (cfg.label || '练习') + '”有一份未完成的进度（已答 ' + doneCount + ' / ' + resumable.questionIds.length + ' 题），是否继续？',
            choices: [
              { key: 'resume', label: '恢复进度', desc: '从第 ' + (resumable.currentIndex + 1) + ' 题继续' },
              { key: 'new', label: '重新开始', desc: '将清除该范围内旧的练习进度并新建' }
            ]
          }).then(function (pick) {
            if (pick == null) return { canceled: true }; /* 用户取消 */
            return { pick: pick, list: list, resumable: resumable };
          });
        });
      }

      return pre.then(function (r) {
        if (r && r.canceled) return null; /* 用户取消 */
        if (r && r.pick === 'resume') {
          T.go('#/quiz/' + r.resumable.id);
          return r.resumable.id;
        }
        var cleanup = r && r.list ? T.db.bulkDelete('sessions', r.list.map(function (s) { return s.id; })) : Promise.resolve();
        return cleanup.then(function () {
          var session = {
            id: T.uuid(),
            scopeKey: scopeKey,
            scope: { mode: cfg.mode, targetId: cfg.targetId || null, label: cfg.label || '练习', order: order, filters: cfg.filters || {} },
            questionIds: order === 'random' ? T.shuffle(questionIds) : questionIds,
            currentIndex: 0,
            answers: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
            done: false,
            originRoute: cfg.origin || (window.location.hash || '#/')
          };
          return T.db.put('sessions', session).then(function () {
            T.go('#/quiz/' + session.id);
            return session.id;
          });
        });
      });
    });
  };

  /* ============ 只读题目展示（错题本 / 收藏 / 题集预览复用） ============ */
  T.renderQuestionStatic = function (q, opts) {
    opts = opts || {};
    var root = T.el('div', { class: 'qview' });
    root.appendChild(T.el('div', { class: 'qview-meta' },
      T.el('span', { class: 'chip chip-type' }, TYPE_LABELS[q.type] || q.type || '未知'),
      q.chapter ? T.el('span', { class: 'chip' }, T.icon('book', 'icon-sm'), q.chapter) : null
    ));
    root.appendChild(T.el('div', { class: 'qview-text' }, q.question || ''));
    var optsNode = T.el('div', { class: 'qview-options' });
    (q.options || []).forEach(function (opt) {
      var isAns = opts.showAnswer !== false && (q.answer || []).indexOf(opt.label) >= 0;
      optsNode.appendChild(T.el('div', { class: 'qview-opt' + (isAns ? ' is-answer' : '') },
        T.el('span', { class: 'opt-label' }, opt.label),
        T.el('span', { class: 'qview-opt-text' }, opt.text)
      ));
    });
    root.appendChild(optsNode);
    if (opts.showAnswer !== false) {
      root.appendChild(T.el('div', { class: 'qview-ans' }, '正确答案：' + (q.answer || []).join('、')));
      if (q.explanation) root.appendChild(T.el('div', { class: 'qview-expl' }, q.explanation));
    }
    return root;
  };
  T.typeLabel = function (t) { return TYPE_LABELS[t] || t || '未知'; };

  /* ============ 刷题页面 ============ */
  T.views.quiz = function (sessionId) {
    var root = T.el('div', { class: 'quiz-root' });
    return T.db.get('sessions', sessionId).then(function (sess) {
      if (!sess) {
        T.toast('练习会话不存在或已被删除', 'error');
        T.go('#/');
        return root;
      }
      return T.db.getMany('questions', sess.questionIds).then(function (qList) {
        var questions = qList.filter(Boolean);
        if (!questions.length) {
          T.toast('该练习的题目已被删除', 'error');
          T.go(sess.originRoute || '#/');
          return root;
        }
        var qMap = new Map();
        questions.forEach(function (q) { qMap.set(q.id, q); });
        /* 题目被删后按剩余题目压缩索引 */
        if (questions.length !== sess.questionIds.length) {
          sess.questionIds = questions.map(function (q) { return q.id; });
          if (sess.currentIndex >= sess.questionIds.length) sess.currentIndex = sess.questionIds.length - 1;
          T.db.put('sessions', sess);
        }

        return Promise.all([
          T.db.getMany('favorites', sess.questionIds),
          T.db.getMany('mistakes', sess.questionIds)
        ]).then(function (r) {
          var favSet = new Set(r[0].filter(Boolean).map(function (f) { return f.questionId; }));
          var mistakeMap = new Map();
          r[1].filter(Boolean).forEach(function (m) { mistakeMap.set(m.questionId, m); });

          var state = { sel: [] };
          var anscardOpen = window.matchMedia && window.matchMedia('(min-width: 721px)').matches;

          function save() {
            sess.updatedAt = Date.now();
            return T.db.put('sessions', sess).catch(function (e) {
              console.error(e);
              T.toast('进度保存失败：' + (e.message || e), 'error');
            });
          }
          function currentQ() { return qMap.get(sess.questionIds[sess.currentIndex]); }
          function answeredCount() {
            var n = 0;
            for (var k in sess.answers) { if (sess.answers[k] && sess.answers[k].submitted) n++; }
            return n;
          }

          function selectLabel(label) {
            var q = currentQ();
            if (!q) return;
            var entry = sess.answers[q.id];
            if (entry && entry.submitted) return;
            if (q.type === 'multiple') {
              var i = state.sel.indexOf(label);
              if (i >= 0) state.sel.splice(i, 1);
              else state.sel.push(label);
            } else {
              state.sel = [label];
            }
            render(false);
          }

          function updateMistakeEntry(q, correct) {
            var m = mistakeMap.get(q.id);
            var get = m ? Promise.resolve(m) : T.db.get('mistakes', q.id);
            return get.then(function (mm) {
              var now = Date.now();
              if (correct) {
                if (!mm) return;
                mm.attempts = (mm.attempts || 1) + 1;
                mm.correctCount = (mm.correctCount || 0) + 1;
                mm.lastAnsweredAt = now;
                mm.mastered = (mm.correctCount || 0) >= 2;
                mistakeMap.set(q.id, mm);
                return T.db.put('mistakes', mm);
              }
              if (mm) {
                mm.attempts = (mm.attempts || 0) + 1;
                mm.lastAnsweredAt = now;
                mm.mastered = false;
                mistakeMap.set(q.id, mm);
                return T.db.put('mistakes', mm);
              }
              var nm = {
                questionId: q.id, setId: q.setId, folderId: q.folderId,
                addedAt: now, attempts: 1, correctCount: 0, lastAnsweredAt: now, mastered: false
              };
              mistakeMap.set(q.id, nm);
              return T.db.put('mistakes', nm);
            });
          }

          function submit() {
            var q = currentQ();
            if (!q) return;
            var entry = sess.answers[q.id];
            if (entry && entry.submitted) {
              T.toast('本题已提交，如需重答请点击“重做”', 'info');
              return;
            }
            if (!state.sel.length) {
              T.toast(q.type === 'multiple' ? '请至少选择一个选项' : '请选择一个答案', 'info');
              return;
            }
            var correct = grade(q, state.sel);
            var rec = {
              questionId: q.id, setId: q.setId, folderId: q.folderId,
              selected: state.sel.slice(), correct: correct, answeredAt: Date.now()
            };
            T.db.put('records', rec).then(function () {
              return updateMistakeEntry(q, correct);
            }).then(function () {
              sess.answers[q.id] = { selected: state.sel.slice(), correct: correct, submitted: true, at: Date.now() };
              return save();
            }).then(function () {
              render(false);
            }).catch(function (e) {
              console.error(e);
              T.toast('保存答题结果失败：' + (e.message || e), 'error');
            });
          }

          function toggleFavorite(q) {
            if (favSet.has(q.id)) {
              T.db.delete('favorites', q.id).then(function () {
                favSet.delete(q.id);
                T.toast('已取消收藏', 'info', 1400);
                render(false);
              });
            } else {
              T.db.put('favorites', { questionId: q.id, setId: q.setId, folderId: q.folderId, addedAt: Date.now() }).then(function () {
                favSet.add(q.id);
                T.toast('已收藏', 'success', 1400);
                render(false);
              });
            }
          }

          function goto(i, scroll) {
            var len = sess.questionIds.length;
            sess.currentIndex = Math.max(0, Math.min(len - 1, i));
            var q = currentQ();
            var entry = q ? sess.answers[q.id] : null;
            state.sel = entry && entry.submitted ? entry.selected.slice() : [];
            save();
            render(scroll !== false);
          }
          function next() {
            if (sess.currentIndex < sess.questionIds.length - 1) goto(sess.currentIndex + 1);
            else finishFlow();
          }
          function prev() { goto(sess.currentIndex - 1); }
          function skip() { next(); }
          function redo() {
            var q = currentQ();
            if (!q) return;
            delete sess.answers[q.id];
            state.sel = [];
            save().then(function () { render(false); });
          }

          function finishFlow() {
            var unanswered = sess.questionIds.length - answeredCount();
            if (unanswered > 0) {
              T.confirm({
                title: '结束练习',
                message: '还有 ' + unanswered + ' 题未作答，确定结束并查看本次结果吗？',
                confirmText: '结束练习'
              }).then(function (ok) { if (ok) finishNow(); });
            } else {
              finishNow();
            }
          }
          function finishNow() {
            sess.done = true;
            sess.finishedAt = Date.now();
            save().then(function () { renderSummary(); });
          }

          /* ---------- 渲染当前题 ---------- */
          function render(scroll) {
            if (sess.done) { renderSummary(); return; }
            var q = currentQ();
            if (!q) { renderSummary(); return; }
            var idx = sess.currentIndex, total = sess.questionIds.length;
            var entry = sess.answers[q.id];
            var submitted = !!(entry && entry.submitted);
            var m = mistakeMap.get(q.id);
            var fav = favSet.has(q.id);

            var top = T.el('div', { class: 'quiz-top' },
              T.el('button', { class: 'btn btn-ghost btn-sm', onClick: function () { T.go(sess.originRoute || '#/'); } },
                T.icon('arrowLeft'), '退出'),
              T.el('div', { class: 'quiz-title' },
                T.el('div', { class: 'quiz-scope', title: sess.scope && sess.scope.label }, sess.scope ? sess.scope.label : '练习'),
                T.el('div', { class: 'quiz-counter' }, '第 ' + (idx + 1) + ' / ' + total + ' 题 · 已答 ' + answeredCount() + ' 题')),
              T.el('div', { class: 'quiz-top-actions' },
                m ? T.el('span', { class: 'chip chip-danger', title: '错题：答对 ' + (m.correctCount || 0) + ' 次 / 共答 ' + (m.attempts || 0) + ' 次' },
                  T.icon('xCircle', 'icon-sm'), '错题') : null,
                m && m.mastered ? T.el('span', { class: 'chip chip-ok' }, T.icon('check', 'icon-sm'), '已答对2次') : null,
                T.el('button', {
                  class: 'icon-btn' + (fav ? ' is-fav' : ''), 'aria-label': '收藏本题',
                  title: fav ? '取消收藏' : '收藏本题',
                  onClick: function () { toggleFavorite(q); }
                }, T.icon(fav ? 'starFill' : 'star')))
            );
            var progress = T.el('div', { class: 'progress' },
              T.el('div', { class: 'progress-fill', style: 'width:' + (total ? (answeredCount() / total * 100).toFixed(1) : 0) + '%' }));

            var meta = T.el('div', { class: 'q-meta' },
              T.el('span', { class: 'chip chip-type' }, TYPE_LABELS[q.type] || q.type),
              q.chapter ? T.el('span', { class: 'chip' }, T.icon('book', 'icon-sm'), q.chapter) : null,
              q.type === 'multiple' ? T.el('span', { class: 'chip' }, '可选多项') : null
            );
            var stem = T.el('div', { class: 'q-text' }, q.question || '');

            var optionsNode = T.el('div', { class: 'q-options' });
            (q.options || []).forEach(function (opt) {
              var cls = 'option';
              if (submitted) {
                var isAns = (q.answer || []).indexOf(opt.label) >= 0;
                var isSel = (entry.selected || []).indexOf(opt.label) >= 0;
                if (isAns) cls += ' correct';
                else if (isSel) cls += ' wrong';
                cls += ' locked';
              } else if (state.sel.indexOf(opt.label) >= 0) {
                cls += ' selected';
              }
              optionsNode.appendChild(T.el('button', {
                class: cls, type: 'button',
                'aria-label': '选项 ' + opt.label,
                onClick: function () { selectLabel(opt.label); }
              },
                T.el('span', { class: 'opt-label' }, opt.label),
                T.el('span', { class: 'opt-text' }, opt.text),
                submitted && (q.answer || []).indexOf(opt.label) >= 0
                  ? T.el('span', { class: 'opt-mark opt-mark-ok' }, T.icon('check')) : null,
                submitted && (entry.selected || []).indexOf(opt.label) >= 0 && (q.answer || []).indexOf(opt.label) < 0
                  ? T.el('span', { class: 'opt-mark opt-mark-bad' }, T.icon('x')) : null
              ));
            });

            var feedback = null;
            if (submitted) {
              feedback = T.el('div', { class: 'q-feedback' },
                T.el('div', { class: 'q-verdict ' + (entry.correct ? 'ok' : 'bad') },
                  entry.correct ? T.icon('checkCircle') : T.icon('xCircle'),
                  T.el('span', {}, entry.correct ? '回答正确' : '回答错误'),
                  T.el('span', { class: 'q-verdict-ans' }, '正确答案：' + (q.answer || []).join('、'))),
                q.explanation
                  ? T.el('div', { class: 'q-expl' }, T.el('div', { class: 'q-expl-title' }, '解析'), T.el('div', { class: 'q-expl-text' }, q.explanation))
                  : T.el('div', { class: 'q-expl-empty' }, '本题没有解析')
              );
            }

            var actions = T.el('div', { class: 'q-actions' },
              T.el('button', { class: 'btn btn-ghost', onClick: prev, disabled: idx === 0 }, T.icon('chevronLeft'), '上一题'),
              submitted
                ? T.el('button', { class: 'btn btn-primary', onClick: next }, idx === total - 1 ? '查看结果' : '下一题', T.icon('chevronRight'))
                : T.el('button', { class: 'btn btn-primary', onClick: submit }, '提交答案'),
              T.el('button', { class: 'btn btn-ghost', onClick: skip, title: '跳过本题，稍后再答' }, '跳过'),
              submitted ? T.el('button', { class: 'btn btn-ghost', onClick: redo, title: '清除本题作答并重新回答（历史答题记录保留）' }, T.icon('refresh'), '重做') : null,
              T.el('button', { class: 'btn btn-ghost btn-sm', onClick: finishFlow }, '结束练习')
            );

            var card = T.el('div', { class: 'card q-card' }, meta, stem, optionsNode, feedback, actions);

            /* 答题卡 */
            var grid = T.el('div', { class: 'anscard-grid' });
            sess.questionIds.forEach(function (qid, i) {
              var a = sess.answers[qid];
              var cls = 'ans-num';
              if (a && a.submitted) cls += a.correct ? ' ok' : ' bad';
              if (i === idx) cls += ' cur';
              grid.appendChild(T.el('button', {
                class: cls, title: '第 ' + (i + 1) + ' 题',
                onClick: function () { goto(i); }
              }, String(i + 1)));
            });
            var legend = T.el('div', { class: 'anscard-legend' },
              T.el('span', {}, T.el('i', { style: 'background:var(--border-2)' }), '未答'),
              T.el('span', {}, T.el('i', { style: 'background:var(--success)' }), '答对'),
              T.el('span', {}, T.el('i', { style: 'background:var(--danger)' }), '答错'),
              T.el('span', {}, T.el('i', { style: 'box-shadow:0 0 0 2px var(--primary)' }), '当前'));
            var anscard = T.el('div', { class: 'anscard' + (anscardOpen ? ' open' : '') },
              T.el('button', {
                class: 'anscard-toggle', onClick: function () { anscardOpen = !anscardOpen; render(false); }
              },
                T.icon('list'), '答题卡',
                T.el('span', { class: 'chip' }, answeredCount() + '/' + total),
                T.icon('chevronDown')),
              T.el('div', { class: 'anscard-body' }, legend, grid));

            root.replaceChildren(top, progress, card, anscard);
            if (scroll !== false) {
              try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }
            }
          }

          /* ---------- 渲染结果页 ---------- */
          function renderSummary() {
            var total = sess.questionIds.length;
            var entries = [];
            for (var k in sess.answers) {
              if (sess.answers[k] && sess.answers[k].submitted) entries.push([k, sess.answers[k]]);
            }
            var answered = entries.length;
            var correct = entries.filter(function (e) { return e[1].correct; }).length;
            var wrongIds = entries.filter(function (e) { return !e[1].correct; }).map(function (e) { return e[0]; });
            var accuracy = answered ? correct / answered : null;

            var stats = T.el('div', { class: 'summary-stats' },
              statCard('总题数', String(total)),
              statCard('已答题数', String(answered)),
              statCard('答对', String(correct), 'is-success'),
              statCard('答错', String(wrongIds.length), 'is-danger'),
              statCard('正确率', T.pct(accuracy), 'is-primary'),
              statCard('用时', T.fmtDuration((sess.finishedAt || sess.updatedAt || Date.now()) - sess.createdAt)));

            var top = T.el('div', { class: 'quiz-top' },
              T.el('button', { class: 'btn btn-ghost btn-sm', onClick: function () { T.go(sess.originRoute || '#/'); } }, T.icon('arrowLeft'), '退出'),
              T.el('div', { class: 'quiz-title' },
                T.el('div', { class: 'quiz-scope' }, (sess.scope ? sess.scope.label : '练习') + ' · 练习结果'),
                T.el('div', { class: 'quiz-counter' }, T.fmtTime(sess.finishedAt || sess.updatedAt))));

            var wrongListNode = null;
            if (wrongIds.length) {
              var wlist = T.el('div', { class: 'wrong-list' });
              wrongIds.forEach(function (qid, i) {
                var q = qMap.get(qid);
                if (!q) return;
                wlist.appendChild(T.el('button', {
                  class: 'wrong-item', onClick: function () {
                    sess.done = false;
                    delete sess.finishedAt;
                    sess.currentIndex = sess.questionIds.indexOf(qid);
                    var e2 = sess.answers[qid];
                    state.sel = e2 && e2.submitted ? e2.selected.slice() : [];
                    save().then(function () { render(true); });
                  }
                },
                  T.el('span', { class: 'wrong-item-idx' }, '第 ' + (sess.questionIds.indexOf(qid) + 1) + ' 题'),
                  T.el('span', { class: 'wrong-item-text' }, q.question || '')));
              });
              wrongListNode = T.el('div', { class: 'card' },
                T.el('h3', {}, '本次答错（' + wrongIds.length + ' 题，点击可回看）'),
                wlist);
            }

            var actions = T.el('div', { class: 'summary-actions' },
              wrongIds.length ? T.el('button', {
                class: 'btn btn-primary', onClick: function () {
                  T.startQuiz({
                    mode: 'ids', questionIds: wrongIds, order: 'seq',
                    label: '错题重练 · ' + (sess.scope ? sess.scope.label : '练习'),
                    origin: sess.originRoute || '#/'
                  });
                }
              }, T.icon('xCircle'), '只练本次错题（' + wrongIds.length + '）') : null,
              T.el('button', {
                class: 'btn btn-ghost', onClick: function () {
                  sess.done = false; delete sess.finishedAt;
                  save().then(function () { render(true); });
                }
              }, T.icon('arrowLeft'), '返回练习'),
              T.el('button', { class: 'btn btn-ghost', onClick: function () { T.go(sess.originRoute || '#/'); } }, '退出并返回'));

            root.replaceChildren(top, stats, wrongListNode, actions);
          }

          function statCard(label, value, cls) {
            return T.el('div', { class: 'stat-card' },
              T.el('div', { class: 'stat-value' + (cls ? ' ' + cls : '') }, value),
              T.el('div', { class: 'stat-label' }, label));
          }

          /* ---------- 键盘快捷键 ---------- */
          function onKey(e) {
            if (T.isModalOpen && T.isModalOpen()) return;
            var tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (sess.done) return;
            var q = currentQ();
            if (!q) return;
            if (/^[1-9]$/.test(e.key)) {
              var i = parseInt(e.key, 10) - 1;
              if (q.options && i < q.options.length) {
                e.preventDefault();
                selectLabel(q.options[i].label);
              }
              return;
            }
            if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              var entry = sess.answers[q.id];
              if (entry && entry.submitted) next();
              else submit();
            }
          }
          document.addEventListener('keydown', onKey);
          T.onCleanup(function () { document.removeEventListener('keydown', onKey); });

          /* 初始渲染 */
          var initQ = currentQ();
          var initEntry = initQ ? sess.answers[initQ.id] : null;
          state.sel = initEntry && initEntry.submitted ? initEntry.selected.slice() : [];
          if (sess.done) renderSummary();
          else render(false);
          return root;
        });
      });
    });
  };
})();
