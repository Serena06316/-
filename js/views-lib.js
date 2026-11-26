/* =====================================================================
   views-lib.js —— 错题本与收藏夹
   支持：跨题集查看、按文件夹/题集筛选、专项刷题、移除、
         （错题）已掌握筛选与批量清理、答题次数/正确次数/最近答题时间
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};
  T.views = T.views || {};
  var el = T.el;

  function statCard(label, value, cls) {
    return el('div', { class: 'stat-card' },
      el('div', { class: 'stat-value' + (cls ? ' ' + cls : '') }, value),
      el('div', { class: 'stat-label' }, label));
  }

  /* 构建文件夹/题集级联筛选器（错题本与收藏夹共用） */
  function buildScopeFilters(state, onChange) {
    var folderSel = el('select', {});
    var setSel = el('select', {});
    var setWrap = el('span', { style: 'display:inline-flex;align-items:center' }, setSel);

    function refreshSets() {
      setSel.replaceChildren(el('option', { value: '' }, '全部题集'));
      setSel.disabled = !state.folderId;
      state.setId = '';
      if (state.folderId) {
        T.db.getAllByIndex('sets', 'by-folder', state.folderId).then(function (sets) {
          sets.forEach(function (s) {
            setSel.appendChild(el('option', { value: s.id }, s.name));
          });
          setSel.value = '';
        });
      }
    }

    T.db.getAll('folders').then(function (folders) {
      folderSel.appendChild(el('option', { value: '' }, '全部文件夹'));
      folders.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      folders.forEach(function (f) { folderSel.appendChild(el('option', { value: f.id }, f.name)); });
    });
    folderSel.addEventListener('change', function () {
      state.folderId = folderSel.value;
      state.setId = '';
      refreshSets();
      onChange();
    });
    setSel.addEventListener('change', function () {
      state.setId = setSel.value;
      onChange();
    });

    return { folderSel: folderSel, setWrap: setWrap, refreshSets: refreshSets };
  }

  function makeLibraryView(config) {
    /* config: { store:'mistakes'|'favorites', title, icon, isMistakes } */
    return function () {
      var root = el('div', { class: 'view-lib' });
      var state = { folderId: '', setId: '', status: 'all', kw: '', limit: 200 };
      var listWrap = el('div', {});
      var countLabel = el('span', { class: 'count-label' }, '加载中…');
      var statusSel = null;
      var allEntries = [];
      var allQuestions = new Map();
      var folderMap = new Map();
      var setMap = new Map();

      function label() {
        var name = config.title;
        if (state.folderId && folderMap.get(state.folderId)) name += ' · ' + folderMap.get(state.folderId).name;
        if (state.setId && setMap.get(state.setId)) name += ' · ' + setMap.get(state.setId).name;
        return name;
      }

      function practice() {
        if (!listWrap.querySelector('.lib-item')) { T.toast('当前没有可练习的题目', 'error'); return; }
        var filters = {};
        if (state.folderId) filters.folderId = state.folderId;
        if (state.setId) filters.setId = state.setId;
        if (config.isMistakes && state.status !== 'all') filters.status = state.status;
        var kw = state.kw.trim();
        T.choice({
          title: '练习' + config.title,
          message: '将按当前筛选条件练习' + (kw ? '（关键词筛选不参与刷题范围）' : '') + '。',
          choices: [
            { key: 'seq', label: '顺序刷题', desc: '按最近作答时间倒序' },
            { key: 'random', label: '随机刷题', desc: '打乱顺序练习' }
          ]
        }).then(function (pick) {
          if (!pick) return;
          T.startQuiz({
            mode: config.store, order: pick, filters: filters,
            label: label(), origin: '#' + (config.isMistakes ? '/mistakes' : '/favorites')
          });
        });
      }

      /* 头部 */
      root.appendChild(el('div', { class: 'section-head', style: 'margin-top:0' },
        el('span', { class: 'quick-ico ' + (config.isMistakes ? 'is-danger' : 'is-warn') }, T.icon(config.icon)),
        el('h1', { style: 'margin:0' }, config.title),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-primary', onClick: practice }, T.icon('play'), '专项刷题')));

      /* 筛选栏 */
      var filters = buildScopeFilters(state, function () { render(); });
      var bar = el('div', { class: 'filter-bar' }, filters.folderSel, filters.setWrap);
      if (config.isMistakes) {
        statusSel = el('select', {},
          el('option', { value: 'all' }, '全部状态'),
          el('option', { value: 'unmastered' }, '未掌握'),
          el('option', { value: 'mastered' }, '已掌握（答对≥2次）'));
        statusSel.addEventListener('change', function () { state.status = statusSel.value; render(); });
        bar.appendChild(statusSel);
      }
      var search = el('input', { type: 'search', class: 'search-input', placeholder: '搜索题干关键词…' });
      search.addEventListener('input', function () { state.kw = search.value; render(); });
      bar.appendChild(search);
      bar.appendChild(countLabel);
      root.appendChild(bar);

      /* 错题批量操作 */
      if (config.isMistakes) {
        var clearBtn = el('button', { class: 'btn btn-ghost btn-sm', onClick: function () {
          var mastered = allEntries.filter(function (e) { return e.mastered; });
          if (!mastered.length) { T.toast('当前没有“已掌握”的错题', 'info'); return; }
          T.confirm({
            title: '清理已掌握错题',
            message: '将移除 ' + mastered.length + ' 道“已掌握（答对≥2次）”的错题记录（原题目与答题历史保留）。未掌握的错题不受影响。',
            confirmText: '清理'
          }).then(function (ok) {
            if (!ok) return;
            T.db.bulkDelete('mistakes', mastered.map(function (m) { return m.questionId; })).then(function () {
              T.toast('已清理 ' + mastered.length + ' 条错题', 'success');
              load();
            });
          });
        } }, T.icon('checkCircle'), '清理已掌握错题');
        root.appendChild(el('div', { style: 'margin:-6px 0 10px' }, clearBtn));
      }

      root.appendChild(listWrap);

      function load() {
        return Promise.all([
          T.db.getAll(config.store),
          T.db.getAll('folders'),
          T.db.getAll('sets')
        ]).then(function (r) {
          allEntries = r[0];
          folderMap = new Map(r[1].map(function (f) { return [f.id, f]; }));
          setMap = new Map(r[2].map(function (s) { return [s.id, s]; }));
          var qids = allEntries.map(function (e) { return e.questionId; });
          return T.db.getMany('questions', qids);
        }).then(function (qs) {
          allQuestions = new Map();
          qs.forEach(function (q) { if (q) allQuestions.set(q.id, q); });
          render();
        });
      }

      function filtered() {
        var kw = state.kw.trim().toLowerCase();
        return allEntries.filter(function (e) {
          if (state.folderId && e.folderId !== state.folderId) return false;
          if (state.setId && e.setId !== state.setId) return false;
          if (config.isMistakes && state.status === 'mastered' && !e.mastered) return false;
          if (config.isMistakes && state.status === 'unmastered' && e.mastered) return false;
          var q = allQuestions.get(e.questionId);
          if (!q) return false;
          if (kw && (q.question || '').toLowerCase().indexOf(kw) < 0) return false;
          return true;
        }).sort(function (a, b) {
          return (b.lastAnsweredAt || b.addedAt || 0) - (a.lastAnsweredAt || a.addedAt || 0);
        });
      }

      function render() {
        var list = filtered();
        countLabel.textContent = '共 ' + list.length + ' 题';
        listWrap.replaceChildren();
        if (!list.length) {
          listWrap.appendChild(el('div', { class: 'card empty-state' },
            T.icon(config.icon, 'icon-lg'),
            el('h3', {}, config.isMistakes ? '暂无错题' : '暂无收藏'),
            el('p', {},
              config.isMistakes
                ? '刷题中答错的题目会自动进入错题本。重新答对 2 次后会标记为“已掌握”。'
                : '在刷题页面点击星标即可收藏题目，方便集中练习。'),
            el('button', { class: 'btn btn-primary', onClick: function () { T.go('#/'); } }, '去刷题')));
          return;
        }
        var libList = el('div', { class: 'lib-list' });
        var slice = list.slice(0, state.limit);
        slice.forEach(function (entry) { libList.appendChild(itemNode(entry)); });
        listWrap.appendChild(libList);
        if (state.limit < list.length) {
          listWrap.appendChild(el('div', { class: 'load-more' },
            el('button', { class: 'btn btn-ghost', onClick: function () { state.limit += 200; render(); } },
              '显示更多（剩余 ' + (list.length - state.limit) + ' 题）')));
        }
      }

      function itemNode(entry) {
        var q = allQuestions.get(entry.questionId);
        var setName = setMap.get(entry.setId) ? setMap.get(entry.setId).name : '（题集已删除）';
        var folderName = folderMap.get(entry.folderId) ? folderMap.get(entry.folderId).name : '';
        var detail = el('div', { class: 'lib-item-detail', style: 'display:none' });
        if (q) detail.appendChild(T.renderQuestionStatic(q, { showAnswer: true }));

        var chips = [
          el('span', { class: 'chip' }, T.icon('layers', 'icon-sm'), setName)
        ];
        if (folderName) chips.push(el('span', { class: 'chip' }, T.icon('folder', 'icon-sm'), folderName));
        if (config.isMistakes) {
          chips.push(el('span', { class: 'chip' }, '作答 ' + (entry.attempts || 0) + ' 次 · 答对 ' + (entry.correctCount || 0) + ' 次'));
          chips.push(entry.mastered
            ? el('span', { class: 'chip chip-ok' }, T.icon('check', 'icon-sm'), '已掌握')
            : el('span', { class: 'chip chip-danger' }, T.icon('xCircle', 'icon-sm'), '未掌握'));
          chips.push(el('span', { class: 'chip' }, '最近：' + T.relTime(entry.lastAnsweredAt || entry.addedAt)));
        } else {
          chips.push(el('span', { class: 'chip' }, '收藏于 ' + T.fmtDate(entry.addedAt)));
        }

        var ops = el('div', { class: 'lib-item-ops' });
        ops.appendChild(el('button', {
          class: 'btn btn-ghost btn-sm',
          onClick: function (e) { e.stopPropagation(); removeEntry(entry); }
        }, T.icon('trash'), config.isMistakes ? '移出错题本' : '取消收藏'));
        if (config.isMistakes && !entry.mastered && q) {
          ops.appendChild(el('button', {
            class: 'btn btn-ghost btn-sm',
            title: '将此错题标记为已掌握（答对 2 次的标准）',
            onClick: function (e) {
              e.stopPropagation();
              entry.mastered = true;
              entry.correctCount = Math.max(entry.correctCount || 0, 2);
              T.db.put('mistakes', entry).then(function () { load(); });
            }
          }, T.icon('check'), '标记已掌握'));
        }
        if (q) detail.appendChild(ops);

        return el('div', { class: 'lib-item' },
          el('div', {
            class: 'lib-item-main', onClick: function () {
              detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
            }
          },
            el('div', { class: 'lib-item-text' }, q ? q.question : '（原题目已删除）'),
            el('div', { class: 'lib-item-meta' }, chips)),
          detail);
      }

      function removeEntry(entry) {
        T.confirm({
          title: config.isMistakes ? '移出错题本' : '取消收藏',
          message: config.isMistakes
            ? '移出后，该题再次答错时会重新进入错题本。原题目与历史答题记录保留。'
            : '取消后可随时在刷题页面重新收藏。',
          confirmText: '确定'
        }).then(function (ok) {
          if (!ok) return;
          T.db.delete(config.store, entry.questionId).then(function () {
            T.toast(config.isMistakes ? '已移出错题本' : '已取消收藏', 'success');
            load();
          });
        });
      }

      return load().then(function () { return root; });
    };
  }

  T.views.mistakes = makeLibraryView({
    store: 'mistakes', title: '错题本', icon: 'xCircle', isMistakes: true
  });

  T.views.favorites = makeLibraryView({
    store: 'favorites', title: '收藏夹', icon: 'star', isMistakes: false
  });
})();
