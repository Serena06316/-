/* =====================================================================
   views-core.js —— 首页（文件夹管理）、文件夹页（题集管理与导入）、题集详情页
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

  /* ================= 文件夹增删改 ================= */
  function createFolder() {
    return T.prompt({
      title: '创建文件夹',
      label: '文件夹名称',
      placeholder: '例如：病理学',
      confirmText: '创建',
      emptyError: '文件夹名称不能为空'
    }).then(function (name) {
      if (name == null) return;
      return T.db.put('folders', { id: T.uuid(), name: name, createdAt: Date.now() }).then(function () {
        T.toast('文件夹「' + name + '」已创建', 'success');
        T.rerender();
      });
    });
  }

  function renameFolder(folder) {
    return T.prompt({
      title: '重命名文件夹',
      label: '文件夹名称',
      value: folder.name,
      confirmText: '保存'
    }).then(function (name) {
      if (name == null || name === folder.name) return;
      folder.name = name;
      return T.db.put('folders', folder).then(function () {
        T.toast('已重命名', 'success');
        T.rerender();
      });
    });
  }

  function deleteFolderCascade(folder) {
    return Promise.all([
      T.db.countByIndex('sets', 'by-folder', folder.id),
      T.db.countByIndex('questions', 'by-folder', folder.id)
    ]).then(function (r) {
      return T.confirm({
        title: '删除文件夹',
        danger: true,
        confirmText: '永久删除',
        message: '将永久删除文件夹「' + folder.name + '」及其 ' + r[0] + ' 个题集、' + r[1] + ' 道题目，' +
          '以及相关的答题记录、错题、收藏和练习进度。此操作不可撤销。'
      }).then(function (ok) {
        if (!ok) return null;
        return Promise.all([
          T.db.getAllByIndex('sets', 'by-folder', folder.id),
          T.db.getAllByIndex('questions', 'by-folder', folder.id),
          T.db.getAllByIndex('records', 'by-folder', folder.id),
          T.db.getAllByIndex('mistakes', 'by-folder', folder.id),
          T.db.getAllByIndex('favorites', 'by-folder', folder.id),
          T.db.getAll('sessions')
        ]).then(function (r2) {
          var setIds = r2[0].map(function (s) { return s.id; });
          var qIds = {};
          r2[1].forEach(function (q) { qIds[q.id] = 1; });
          var recordIds = r2[2].map(function (r) { return r.id; });
          var mistakeKeys = r2[3].map(function (m) { return m.questionId; });
          var favKeys = r2[4].map(function (f) { return f.questionId; });
          var sessionIds = r2[5].filter(function (s) {
            if (s.scope && (s.scope.targetId === folder.id || (s.scope.mode === 'set' && setIds.indexOf(s.scope.targetId) >= 0))) return true;
            return (s.questionIds || []).some(function (id) { return qIds[id]; });
          }).map(function (s) { return s.id; });
          return T.db.run(T.db.stores, 'readwrite', function (t) {
            t.objectStore('folders').delete(folder.id);
            setIds.forEach(function (id) { t.objectStore('sets').delete(id); });
            qIds && Object.keys(qIds).forEach(function (id) { t.objectStore('questions').delete(id); });
            recordIds.forEach(function (id) { t.objectStore('records').delete(id); });
            mistakeKeys.forEach(function (id) { t.objectStore('mistakes').delete(id); });
            favKeys.forEach(function (id) { t.objectStore('favorites').delete(id); });
            sessionIds.forEach(function (id) { t.objectStore('sessions').delete(id); });
          }).then(function () {
            T.toast('文件夹已删除', 'success');
            T.go('#/');
          });
        });
      });
    });
  }

  /* ================= 首页 ================= */
  T.views.home = function () {
    var root = el('div', { class: 'view-home' });
    return T.stats.global().then(function (stats) {
      /* 全局统计 */
      root.appendChild(el('div', { class: 'section-head' }, el('h2', {}, '全局统计')));
      root.appendChild(el('div', { class: 'stat-grid' },
        statCard('文件夹', String(stats.folders)),
        statCard('题集', String(stats.sets)),
        statCard('总题数', String(stats.questions)),
        statCard('已答题数', String(stats.answered)),
        statCard('答对题数', String(stats.correct), 'is-success'),
        statCard('错题数', String(stats.mistakes), 'is-danger'),
        statCard('收藏数', String(stats.favorites), 'is-primary'),
        statCard('总体正确率', T.pct(stats.accuracy), 'is-primary')
      ));
      root.appendChild(el('p', { style: 'color:var(--muted);font-size:12.5px;margin:8px 0 0' },
        '统计口径：答对/答错按每题最近一次作答计算；同一题重复作答计入“尝试次数”。'));

      /* 文件夹区 */
      var head = el('div', { class: 'section-head' },
        el('h2', {}, '我的文件夹'),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-primary', onClick: createFolder }, T.icon('folderPlus'), '创建文件夹'));
      root.appendChild(head);

      return T.db.getAll('folders').then(function (allFolders) {
        /* 内置公共题库的文件夹不混入「我的文件夹」，在下方单独展示 */
        var folders = allFolders.filter(function (f) { return f.origin !== 'public'; });
        folders.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
        if (!folders.length) {
          root.appendChild(el('div', { class: 'card empty-state' },
            T.icon('folder', 'icon-lg'),
            el('h2', {}, '还没有文件夹'),
            el('p', {}, '创建第一个文件夹来管理你的课程题库，例如「病理学」「医学统计学」。文件夹与题集数据保存在本浏览器中。'),
            el('button', { class: 'btn btn-primary btn-lg', onClick: createFolder }, T.icon('folderPlus'), '创建文件夹')));
          return appendPublicSection(root);
        }
        var grid = el('div', { class: 'folder-grid' });
        var counts = Promise.all(folders.map(function (f) {
          return Promise.all([
            T.db.countByIndex('sets', 'by-folder', f.id),
            T.db.countByIndex('questions', 'by-folder', f.id)
          ]);
        }));
        return counts.then(function (cs) {
          folders.forEach(function (f, i) {
            grid.appendChild(el('div', {
              class: 'folder-card', onClick: function () { T.go('#/folder/' + f.id); },
              role: 'button', tabindex: '0'
            },
              el('div', { class: 'folder-card-top' },
                el('span', { class: 'folder-ico' }, T.icon('folder')),
                el('div', { style: 'flex:1;min-width:0' },
                  el('div', { class: 'folder-name' }, f.name),
                  el('div', { class: 'folder-meta' }, cs[i][0] + ' 个题集 · ' + cs[i][1] + ' 道题目'))),
              el('div', { class: 'folder-card-actions' },
                el('button', { class: 'icon-btn', title: '重命名', 'aria-label': '重命名', onClick: function (e) { e.stopPropagation(); renameFolder(f); } }, T.icon('edit')),
                el('button', { class: 'icon-btn', title: '导出备份', 'aria-label': '导出备份', onClick: function (e) { e.stopPropagation(); T.backup.exportFolder(f.id); } }, T.icon('download')),
                el('button', { class: 'icon-btn', title: '删除', 'aria-label': '删除', onClick: function (e) { e.stopPropagation(); deleteFolderCascade(f); } }, T.icon('trash')))
            ));
          });
          root.appendChild(grid);
          return appendPublicSection(root);
        });
      });
    });
  };

  /* ================= 首页：内置公共题库区（仓库 question-banks/ 目录） ================= */
  function appendPublicSection(root) {
    return T.public.sync().then(function (res) {
      if (res.ok && res.structure && res.structure.length) {
        var head = el('div', { class: 'section-head' },
          el('span', { class: 'folder-ico pub' }, T.icon('layers')),
          el('h2', {}, '内置公共题库'),
          el('span', { class: 'chip', title: '所有人可见的站点内置题库' }, '公共'),
          res.stale ? el('span', { class: 'chip chip-warn', title: res.offline ? '网络不可用，展示本地已缓存内容' : '未能拉取最新清单，展示上次缓存' }, res.offline ? '离线缓存' : '缓存') : null,
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'btn btn-ghost btn-sm', title: '重新从站点拉取内置题库清单',
            onClick: function () {
              T.toast('正在刷新内置题库清单…', 'info', 1600);
              T.public.sync(true).then(function () { T.rerender(); });
            }
          }, T.icon('refresh'), '刷新'));
        var grid = el('div', { class: 'folder-grid' });
        res.structure.forEach(function (f) {
          var q = 0;
          f.sets.forEach(function (s) { q += (s.publicCount || 0); });
          grid.appendChild(el('div', {
            class: 'folder-card', role: 'button', tabindex: '0',
            onClick: function () { T.go('#/folder/' + f.record.id); }
          },
            el('div', { class: 'folder-card-top' },
              el('span', { class: 'folder-ico pub' }, T.icon('layers')),
              el('div', { style: 'flex:1;min-width:0' },
                el('div', { class: 'folder-name' }, f.record.name),
                el('div', { class: 'folder-meta' },
                  f.sets.length + ' 个题集' + (q ? ' · 约 ' + q + ' 道题' : '')))),
            el('div', { class: 'folder-card-actions' },
              el('span', { class: 'chip' }, '公共'))));
        });
        root.appendChild(head);
        root.appendChild(grid);
        root.appendChild(el('p', { style: 'color:var(--muted);font-size:12.5px;margin:8px 0 0' },
          '内置公共题库由本站维护者统一提供，对所有人可见；首次打开题集时自动下载缓存，你的答题记录、错题与收藏只保存在本地。'));
      } else if (res.reason === 'offline' || res.reason === 'invalid') {
        root.appendChild(el('p', { style: 'color:var(--muted);font-size:13px;margin:10px 0 0' },
          '内置公共题库当前不可用（可能是网络原因），可稍后重试。'));
      }
      return root;
    });
  };


  /* ================= 导入流程 ================= */
  function qhash(q) {
    return JSON.stringify([q.type, q.question, q.options.map(function (o) { return o.text; }), q.answer]);
  }

  function uniqueSetName(existingSets, name) {
    var names = existingSets.map(function (s) { return s.name; });
    if (names.indexOf(name) < 0) return name;
    for (var i = 2; ; i++) {
      var cand = name + ' (' + i + ')';
      if (names.indexOf(cand) < 0) return cand;
    }
  }

  /* 将解析结果保存到文件夹（含重名处理：新建重命名 / 合并 / 跳过） */
  function saveParsedToFolder(folder, parsed, existingSets) {
    var name = String(parsed.name || '未命名题集').trim() || '未命名题集';
    var pre = Promise.resolve('new'); /* 无重名冲突时默认新建 */
    var dup = existingSets.filter(function (s) { return s.name === name; })[0] || null;
    if (dup) {
      var autoName = uniqueSetName(existingSets, name);
      pre = T.choice({
        title: '题集名称已存在',
        message: '文件夹「' + folder.name + '」中已有名为「' + name + '」的题集。请选择处理方式：',
        choices: [
          { key: 'new', label: '创建为新题集', desc: '将自动命名为「' + autoName + '」' },
          { key: 'merge', label: '合并到现有题集「' + name + '」', desc: '题干、选项与答案完全相同的题目会被跳过，其余追加' },
          { key: 'skip', label: '跳过此文件', desc: '不做任何改动' }
        ]
      });
    }
    return pre.then(function (pick) {
      if (pick === null) pick = 'skip'; /* 取消对话框按跳过处理 */
      if (pick === 'skip') return { skipped: true, summary: '已跳过（用户选择）' };

      var targetSet = pick === 'merge' ? dup : null;
      var finalName = targetSet ? name : (pick === 'new' ? uniqueSetName(existingSets, name) : name);
      var setId = targetSet ? targetSet.id : T.uuid();
      var isNew = !targetSet;

      var loadExisting = targetSet
        ? T.db.getAllByIndex('questions', 'by-set', setId)
        : Promise.resolve([]);
      return loadExisting.then(function (existingQs) {
        var existHashes = new Set(existingQs.map(qhash));
        var existIds = new Set(existingQs.map(function (q) { return q.id; }));
        var startOrder = existingQs.length ? Math.max.apply(null, existingQs.map(function (q) { return q.order || 0; })) + 1 : 0;
        var out = [];
        var dupCount = 0;
        parsed.questions.forEach(function (q, i) {
          if (targetSet && existHashes.has(qhash(q))) { dupCount++; return; }
          var base = setId + '::' + (q.rawId != null ? q.rawId : ('q' + (i + 1)));
          var id = base, n = 1;
          while (existIds.has(id)) { n++; id = base + '-' + n; }
          existIds.add(id);
          out.push({
            id: id, setId: setId, folderId: folder.id,
            type: q.type, question: q.question, options: q.options, answer: q.answer,
            explanation: q.explanation || '', chapter: q.chapter || '',
            order: startOrder + out.length
          });
        });

        return T.db.run(['sets', 'questions'], 'readwrite', function (t) {
          if (isNew) {
            t.objectStore('sets').put({
              id: setId, folderId: folder.id, name: finalName,
              createdAt: Date.now(), sourceName: parsed.sourceName || ''
            });
          }
          var os = t.objectStore('questions');
          out.forEach(function (q) { os.put(q); });
        }).then(function () {
          var skippedInfo = parsed.skipped && parsed.skipped.length
            ? '，跳过 ' + parsed.skipped.length + ' 条无效题目（' + parsed.skipped.slice(0, 2).map(function (s) { return s.error; }).join('；') + (parsed.skipped.length > 2 ? '…' : '') + '）'
            : '';
          var summary = targetSet
            ? '已合并到「' + targetSet.name + '」：新增 ' + out.length + ' 题，跳过 ' + dupCount + ' 题重复' + skippedInfo
            : '已创建「' + finalName + '」：导入 ' + out.length + ' 题' + skippedInfo;
          if (parsed.warnings && parsed.warnings.length) {
            parsed.warnings.slice(0, 3).forEach(function (w) { T.toast(w, 'warning', 3600); });
          }
          return { skipped: false, setRecord: { id: setId, name: finalName }, summary: summary, added: out.length };
        });
      });
    });
  }

  /* 批量文件导入（带进度弹窗） */
  function importFilesFlow(folder, files) {
    files = Array.prototype.slice.call(files).filter(Boolean);
    if (!files.length) return Promise.resolve();
    var wrap = el('div', { class: 'import-list' });
    var items = files.map(function (f) { return { file: f, status: 'waiting', msg: '等待中' }; });
    items.forEach(function (it) {
      wrap.appendChild(el('div', { class: 'import-row' },
        T.icon('file'),
        el('div', { class: 'import-row-main' },
          el('div', { class: 'import-file' }, it.file.name || '未命名文件'),
          el('div', { class: 'import-msg' }, it.msg))
      ));
    });
    var doneBtn = el('button', { class: 'btn btn-primary', disabled: true, onClick: function () { modal.close(); T.rerender(); } }, '完成');
    var modal = T.openModal({
      title: '导入题库（' + files.length + ' 个文件）',
      node: el('div', {}, wrap, el('div', { class: 'modal-foot' }, doneBtn))
    });
    function refresh() {
      var rows = wrap.querySelectorAll('.import-row');
      items.forEach(function (it, i) {
        var row = rows[i];
        if (!row) return;
        var msgEl = row.querySelector('.import-msg');
        var statusEl = row.querySelector('.import-status');
        if (!statusEl) {
          statusEl = el('span', { class: 'import-status' });
          row.appendChild(statusEl);
        }
        statusEl.className = 'import-status chip ' + (it.status === 'success' ? 'chip-ok' : it.status === 'failed' ? 'chip-danger' : it.status === 'skipped' ? 'chip-warn' : '');
        statusEl.textContent = it.status === 'waiting' ? '等待' : it.status === 'parsing' ? '解析中' :
          it.status === 'success' ? '成功' : it.status === 'failed' ? '失败' : '跳过';
        if (msgEl) {
          msgEl.textContent = it.msg;
          msgEl.className = 'import-msg ' + (it.status === 'failed' ? 'is-fail' : it.status === 'success' ? 'is-ok' : '');
        }
      });
    }

    return T.db.getAllByIndex('sets', 'by-folder', folder.id).then(function (existingSets) {
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () {
          it.status = 'parsing'; it.msg = '正在解析文件…'; refresh();
          return T.parseQuestionFile(it.file).then(function (parsed) {
            if (!parsed.ok) {
              it.status = 'failed';
              it.msg = parsed.error + (parsed.hint ? '（可查看使用说明）' : '');
              refresh();
              return null;
            }
            it.msg = '解析成功：' + parsed.questions.length + ' 题';
            return saveParsedToFolder(folder, parsed, existingSets).then(function (r) {
              it.status = r.skipped ? 'skipped' : 'success';
              it.msg = r.summary;
              if (r.setRecord) existingSets.push(r.setRecord);
              refresh();
            }).catch(function (e) {
              it.status = 'failed';
              it.msg = '保存失败：' + (e.message || e);
              refresh();
            });
          }).catch(function (e) {
            it.status = 'failed';
            it.msg = '解析失败：' + (e.message || e);
            refresh();
          });
        });
      });
      return chain.then(function () {
        doneBtn.disabled = false;
        T.toast('导入处理完成', 'success');
      });
    });
  }

  /* 粘贴导入 */
  function pasteImportFlow(folder) {
    var ta = el('textarea', { rows: 12, placeholder: '在此粘贴题库内容…\n\n支持 JSON（以 { 或 [ 开头）或 TXT 格式的题目内容。格式说明见「使用说明」。' });
    var err = el('div', { class: 'input-error' });
    var modal = T.openModal({
      title: '粘贴导入题库',
      node: el('div', {},
        el('p', { style: 'color:var(--muted);font-size:13px;margin-top:0' },
          '适合题量较少或临时粘贴的场景。粘贴后将创建一个新题集（若重名将询问处理方式）。'),
        ta, err,
        el('div', { class: 'modal-foot' },
          el('a', { href: '#/help', class: 'btn btn-ghost', onClick: function () { modal.close(); } }, '格式说明'),
          el('button', {
            class: 'btn btn-primary', onClick: function () {
              var text = String(ta.value || '').trim();
              if (!text) { err.textContent = '内容不能为空'; return; }
              err.textContent = '';
              var parsed = (text.charAt(0) === '{' || text.charAt(0) === '[')
                ? T.parseJSONBank(text, '粘贴题库')
                : T.parseTXTBank(text, '粘贴题库');
              if (!parsed.ok) { err.textContent = parsed.error; return; }
              parsed.sourceName = '粘贴导入';
              T.db.getAllByIndex('sets', 'by-folder', folder.id).then(function (existingSets) {
                return saveParsedToFolder(folder, parsed, existingSets);
              }).then(function (r) {
                modal.close();
                T.toast(r.summary, r.skipped ? 'info' : 'success', 3600);
                T.rerender();
              }).catch(function (e) {
                err.textContent = '导入失败：' + (e.message || e);
              });
            }
          }, T.icon('upload'), '导入')
        )
      )
    });
  }

  /* ================= 文件夹页 ================= */
  T.views.folder = function (folderId) {
    var el_ = el;
    var root = el_('div', { class: 'view-folder' });
    return T.db.get('folders', folderId).then(function (folder) {
      if (!folder) {
        T.toast('文件夹不存在或已删除', 'error');
        T.go('#/');
        return root;
      }
      return Promise.all([
        T.db.getAllByIndex('sets', 'by-folder', folderId),
        T.stats.folderStats(folderId)
      ]).then(function (r) {
        var sets = r[0].sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
        var fstats = r[1];
        var isPub = folder.origin === 'public';

        root.appendChild(el_('a', { class: 'back-link', href: '#/' }, T.icon('arrowLeft', 'icon-sm'), '返回文件夹列表'));
        root.appendChild(el_('div', { class: 'section-head', style: 'margin-top:0' },
          el_('span', { class: 'folder-ico' + (isPub ? ' pub' : '') }, T.icon(isPub ? 'layers' : 'folder')),
          el_('h1', { style: 'margin:0;word-break:break-all' }, folder.name),
          isPub ? el_('span', { class: 'chip', title: '所有人可见的站点内置题库' }, '公共') : null,
          el_('span', { class: 'spacer' }),
          el_('button', { class: 'btn btn-primary', onClick: practiceWholeFolder }, T.icon('play'), '刷整个文件夹'),
          isPub ? el_('button', {
            class: 'icon-btn', title: '同步内置题库清单', onClick: function () {
              T.toast('正在同步内置题库清单…', 'info', 1600);
              T.public.sync(true).then(function () { T.rerender(); });
            }
          }, T.icon('refresh')) : null,
          isPub ? null : el_('button', { class: 'icon-btn', title: '重命名文件夹', onClick: function () { renameFolder(folder); } }, T.icon('edit')),
          isPub ? null : el_('button', { class: 'icon-btn', title: '导出文件夹备份', onClick: function () { T.backup.exportFolder(folderId); } }, T.icon('download')),
          isPub ? null : el_('button', { class: 'icon-btn', title: '删除文件夹', onClick: function () { deleteFolderCascade(folder); } }, T.icon('trash'))));

        if (isPub) {
          root.appendChild(el_('div', { class: 'help-notice', style: 'margin-top:14px' },
            T.icon('info'),
            el_('div', {},
              '该文件夹来自站点内置公共题库，内容由维护者在仓库 question-banks/ 目录统一更新，所有人看到的内容一致；此处不能导入或删除。' +
              '你在这些题集上的练习进度、错题与收藏属于你自己，保存在本地。')));
        }

        root.appendChild(el_('div', { class: 'stat-grid' },
          statCard('题集数', String(fstats.sets)),
          statCard('题目总量', String(fstats.questions)),
          statCard('已答题数', String(fstats.answered)),
          statCard('正确率', T.pct(fstats.accuracy), 'is-primary'),
          statCard('错题数', String(fstats.mistakes), 'is-danger'),
          statCard('收藏数', String(fstats.favorites))));

        function practiceWholeFolder() {
          var pre = isPub
            ? (function () {
                /* 公共文件夹：先把全部题集下载到本地，再统计题量 */
                T.toast('正在准备内置题库…', 'info', 2000);
                var chain = Promise.resolve();
                sets.forEach(function (s) {
                  chain = chain.then(function () { return T.public.ensureSetLoaded(s); });
                });
                return chain;
              })()
            : Promise.resolve();
          pre.then(function () {
            return T.db.countByIndex('questions', 'by-folder', folderId);
          }).then(function (cnt) {
            if (!cnt) { T.toast('该文件夹还没有题目' + (isPub ? '，请先打开一次题集完成下载' : '，请先导入题库'), 'error'); return; }
            T.choice({
              title: '刷整个文件夹',
              message: '将练习「' + folder.name + '」内全部 ' + cnt + ' 道题目（含所有题集）。当前模式：' + T.quizModeLabel(T.quizModeDefault()) + '（进入后可切换）。',
              choices: [
                { key: 'seq', label: '顺序刷题', desc: '按题集导入顺序依次练习' },
                { key: 'random', label: '随机刷题', desc: '打乱全部题目顺序' }
              ]
            }).then(function (pick) {
              if (!pick) return;
              T.startQuiz({
                mode: 'folder', targetId: folderId, order: pick,
                label: folder.name + '（整个文件夹）', origin: '#/folder/' + folderId
              });
            });
          }).catch(function (e) { T.toast('准备失败：' + (e.message || e), 'error'); });
        }

        /* 导入区（内置公共文件夹不提供导入） */
        if (!isPub) {
        var fileInput = el_('input', {
          type: 'file', multiple: true, style: 'display:none',
          accept: '.json,.txt,.csv,.docx,application/json,text/plain'
        });
        fileInput.addEventListener('change', function () {
          if (fileInput.files && fileInput.files.length) {
            importFilesFlow(folder, fileInput.files);
          }
          fileInput.value = '';
        });
        root.appendChild(fileInput);

        var dropzone = el_('div', {
          class: 'dropzone', role: 'button', tabindex: '0',
          onClick: function () { fileInput.click(); }
        },
          T.icon('upload', 'icon-lg'),
          el_('div', { class: 'dropzone-title' }, '点击选择文件，或把题库文件拖到这里'),
          el_('div', { class: 'dropzone-sub' }, '支持 JSON / TXT / CSV / DOCX，可一次选择多个文件，每个文件成为一个独立题集'));
        var dz = dropzone;
        function onDragOver(e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); }
        function onDragLeave(e) { if (e.target === dz) dz.classList.remove('drag'); }
        function onDrop(e) {
          e.preventDefault(); e.stopPropagation();
          dz.classList.remove('drag');
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            importFilesFlow(folder, e.dataTransfer.files);
          }
        }
        dz.addEventListener('dragenter', onDragOver);
        dz.addEventListener('dragover', onDragOver);
        dz.addEventListener('dragleave', onDragLeave);
        dz.addEventListener('drop', onDrop);
        T.onCleanup(function () {
          dz.removeEventListener('dragenter', onDragOver);
          dz.removeEventListener('dragover', onDragOver);
          dz.removeEventListener('dragleave', onDragLeave);
          dz.removeEventListener('drop', onDrop);
        });

        root.appendChild(el_('div', { class: 'card', style: 'margin-top:18px' },
          el_('h2', {}, '导入题库'),
          dz,
          el_('div', { class: 'import-actions' },
            el_('button', { class: 'btn btn-ghost', onClick: function () { fileInput.click(); } }, T.icon('upload'), '选择文件'),
            el_('button', { class: 'btn btn-ghost', onClick: function () { pasteImportFlow(folder); } }, T.icon('edit'), '粘贴导入'),
            el_('a', { href: '#/help', class: 'btn btn-ghost' }, T.icon('helpCircle'), '格式说明'),
            el_('span', { class: 'chip', style: 'margin-left:auto' }, '重复导入时会询问：新建 / 合并 / 跳过'))));
        }

        /* 题集列表 */
        root.appendChild(el_('div', { class: 'section-head' }, el_('h2', {}, '题集列表')));
        if (!sets.length) {
          root.appendChild(el_('div', { class: 'card empty-state' },
            T.icon('layers', 'icon-lg'),
            el_('h3', {}, isPub ? '该公共文件夹暂未提供题集' : '该文件夹还没有题集'),
            el_('p', {}, isPub
              ? '内置题库清单中没有属于该文件夹的题集，可点击右上角刷新按钮重新同步。'
              : '导入 JSON / TXT / CSV / DOCX 题库文件后，每个文件会成为一个独立题集，保存在本浏览器中。'),
            isPub ? null : el_('div', {},
              el_('button', { class: 'btn btn-primary', onClick: function () { fileInput.click(); } }, T.icon('upload'), '导入题库文件'),
              ' ',
              el_('button', { class: 'btn btn-ghost', onClick: function () { pasteImportFlow(folder); } }, '粘贴导入'))));
          return root;
        }

        var listWrap = el_('div', {});
        var searchInput = el_('input', { type: 'search', class: 'search-input', placeholder: '筛选题集名称…' });
        var countLabel = el_('span', { class: 'count-label' }, '');
        root.appendChild(el_('div', { class: 'toolbar' },
          el_('span', { class: 'icon-btn', style: 'pointer-events:none' }, T.icon('search')),
          searchInput, countLabel));
        root.appendChild(listWrap);

        function renderList(filter) {
          var kw = (filter || '').trim().toLowerCase();
          var shown = sets.filter(function (s) { return !kw || s.name.toLowerCase().indexOf(kw) >= 0; });
          countLabel.textContent = '共 ' + sets.length + ' 个题集' + (kw ? '，匹配 ' + shown.length + ' 个' : '');
          listWrap.replaceChildren();
          if (!shown.length) {
            listWrap.appendChild(el_('div', { class: 'card empty-state' }, T.icon('search'), el_('p', {}, '没有匹配的题集')));
            return;
          }
          var list = el_('div', { class: 'set-list' });
          shown.forEach(function (s) {
            list.appendChild(setRow(s));
          });
          listWrap.appendChild(list);
        }

        function setRow(s) {
          return el_('div', {
            class: 'set-row', role: 'button', tabindex: '0',
            onClick: function (e) {
              if (e.target.closest('button')) return;
              T.go('#/set/' + s.id);
            }
          },
            el_('span', { class: 'set-ico' }, T.icon('layers')),
            el_('div', { class: 'set-row-main' },
              el_('div', { class: 'set-row-name' }, s.name),
              el_('div', { class: 'set-row-meta', 'data-set-stats': s.id })),
            el_('div', { class: 'set-row-ops' },
              el_('button', { class: 'btn btn-primary btn-sm', onClick: function (e) { e.stopPropagation(); quickPractice(s); } }, T.icon('play'), '刷题'),
              s.origin === 'public' ? null : el_('button', { class: 'icon-btn', title: '重命名题集', onClick: function (e) { e.stopPropagation(); renameSet(s); } }, T.icon('edit')),
              s.origin === 'public' ? null : el_('button', { class: 'icon-btn', title: '导出题集备份', onClick: function (e) { e.stopPropagation(); T.backup.exportSet(s.id); } }, T.icon('download')),
              s.origin === 'public' ? null : el_('button', { class: 'icon-btn', title: '删除题集', onClick: function (e) { e.stopPropagation(); deleteSetCascade(s); } }, T.icon('trash'))),
            (function () {
              /* 异步填充该题集的迷你统计（公共题集未下载时显示清单题量） */
              T.stats.setStats(s.id).then(function (st) {
                var meta = listWrap.querySelector('[data-set-stats="' + s.id + '"]');
                if (meta) {
                  meta.textContent = '';
                  if (!st.questions && s.publicCount) {
                    meta.appendChild(el_('span', {}, s.publicCount + ' 题'));
                    meta.appendChild(el_('span', { class: 'pub-hint' }, '未下载，点击自动获取'));
                  } else {
                    meta.appendChild(el_('span', {}, st.questions + ' 题'));
                    meta.appendChild(el_('span', {}, '已答 ' + st.answered));
                    meta.appendChild(el_('span', {}, '正确率 ' + T.pct(st.accuracy)));
                    if (st.mistakes) meta.appendChild(el_('span', { style: 'color:var(--danger)' }, '错题 ' + st.mistakes));
                  }
                }
              });
              return null;
            })());
        }

        function quickQuizMenu(pick) { return pick; }
        function quickPractice(s) {
          var pre = s.origin === 'public'
            ? T.public.ensureSetLoaded(s)
            : Promise.resolve({ ok: true });
          pre.then(function (r) {
            if (r && r.ok === false) { T.toast(r.error || '内置题库下载失败', 'error', 3600); return; }
            T.db.countByIndex('questions', 'by-set', s.id).then(function (cnt) {
              if (!cnt) { T.toast('该题集没有题目', 'error'); return; }
              return T.choice({
                title: '刷「' + s.name + '」',
                message: '该题集共 ' + cnt + ' 道题。当前模式：' + T.quizModeLabel(T.quizModeDefault()) + '（进入后可切换）。',
                choices: [
                  { key: 'seq', label: '顺序刷题', desc: '按题目原始顺序' },
                  { key: 'random', label: '随机刷题', desc: '打乱顺序练习' }
                ]
              }).then(function (pick) {
                if (!pick) return;
                T.startQuiz({
                  mode: 'set', targetId: s.id, order: pick,
                  label: s.name, origin: '#/set/' + s.id
                });
              });
            });
          });
        }

        function renameSet(s) {
          T.prompt({ title: '重命名题集', label: '题集名称', value: s.name, confirmText: '保存' }).then(function (name) {
            if (name == null || name === s.name) return;
            s.name = name;
            T.db.put('sets', s).then(function () {
              T.toast('已重命名', 'success');
              T.rerender();
            });
          });
        }

        function deleteSetCascade(s) {
          Promise.all([
            T.db.countByIndex('questions', 'by-set', s.id)
          ]).then(function (r) {
            return T.confirm({
              title: '删除题集',
              danger: true,
              confirmText: '永久删除',
              message: '将永久删除题集「' + s.name + '」及其 ' + r[0] + ' 道题目，以及相关的答题记录、错题、收藏和练习进度。此操作不可撤销。'
            }).then(function (ok) {
              if (!ok) return null;
              return Promise.all([
                T.db.getAllByIndex('questions', 'by-set', s.id),
                T.db.getAllByIndex('records', 'by-set', s.id),
                T.db.getAllByIndex('mistakes', 'by-set', s.id),
                T.db.getAllByIndex('favorites', 'by-set', s.id),
                T.db.getAll('sessions')
              ]).then(function (r2) {
                var qIds = r2[0].map(function (q) { return q.id; });
                var qSet = {};
                qIds.forEach(function (id) { qSet[id] = 1; });
                var recordIds = r2[1].map(function (x) { return x.id; });
                var mistakeKeys = r2[2].map(function (x) { return x.questionId; });
                var favKeys = r2[3].map(function (x) { return x.questionId; });
                var sessionIds = r2[4].filter(function (ss) {
                  if (ss.scope && ss.scope.targetId === s.id) return true;
                  return (ss.questionIds || []).some(function (id) { return qSet[id]; });
                }).map(function (ss) { return ss.id; });
                return T.db.run(T.db.stores, 'readwrite', function (t) {
                  t.objectStore('sets').delete(s.id);
                  qIds.forEach(function (id) { t.objectStore('questions').delete(id); });
                  recordIds.forEach(function (id) { t.objectStore('records').delete(id); });
                  mistakeKeys.forEach(function (id) { t.objectStore('mistakes').delete(id); });
                  favKeys.forEach(function (id) { t.objectStore('favorites').delete(id); });
                  sessionIds.forEach(function (id) { t.objectStore('sessions').delete(id); });
                }).then(function () {
                  T.toast('题集已删除', 'success');
                  T.rerender();
                });
              });
            });
          });
        }

        searchInput.addEventListener('input', function () { renderList(searchInput.value); });
        renderList('');
        return root;
      });
    });
  };

  /* ================= 题集详情页 ================= */
  T.views.setDetail = function (setId) {
    var el_ = el;
    var root = el_('div', { class: 'view-set' });
    return T.db.get('sets', setId).then(function (set) {
      if (!set) {
        T.toast('题集不存在或已删除', 'error');
        T.go('#/');
        return root;
      }
      var isPub = set.origin === 'public';
      /* 公共题集：先确保内容已下载到本地（首次打开/清单更新时自动拉取） */
      var pre = isPub
        ? T.public.ensureSetLoaded(set).then(function (r) {
            if (r.ok) return set;
            root.appendChild(el_('a', { class: 'back-link', href: '#/folder/' + set.folderId }, T.icon('arrowLeft', 'icon-sm'), '返回题集列表'));
            root.appendChild(el_('div', { class: 'card empty-state', style: 'max-width:560px;margin:40px auto' },
              T.icon('alertCircle', 'icon-lg'),
              el_('h2', {}, '内置题库下载失败'),
              el_('p', { style: 'color:var(--muted)' }, r.error || '请检查网络后重试。'),
              el_('button', { class: 'btn btn-primary', onClick: function () { T.rerender(); } }, T.icon('refresh'), '重试')));
            return null;
          })
        : Promise.resolve(set);
      return pre.then(function (set) {
        if (!set) return root;
      return Promise.all([
        T.db.get('folders', set.folderId),
        T.db.getAllByIndex('questions', 'by-set', setId),
        T.stats.setStats(setId)
      ]).then(function (r) {
        var folder = r[0];
        var questions = r[1].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        var st = r[2];

        root.appendChild(el_('a', { class: 'back-link', href: '#/folder/' + set.folderId }, T.icon('arrowLeft', 'icon-sm'), '返回「' + (folder ? folder.name : '文件夹') + '」'));
        root.appendChild(el_('div', { class: 'section-head', style: 'margin-top:0' },
          el_('span', { class: 'set-ico' }, T.icon('layers')),
          el_('div', {},
            el_('h1', { style: 'margin:0;word-break:break-all' }, set.name),
            el_('div', { class: 'folder-meta' },
              (folder ? '文件夹：' + folder.name + ' · ' : '') + questions.length + ' 道题 · ' +
              (isPub ? '内置公共题库' : '导入于 ' + T.fmtDate(set.createdAt)),
              isPub ? el_('span', { class: 'chip', title: '所有人可见的站点内置题库' }, '公共') : null)),
          el_('span', { class: 'spacer' }),
          isPub ? el_('button', {
            class: 'icon-btn', title: '同步更新（重新下载该题库文件）', onClick: function () {
              T.toast('正在同步「' + set.name + '」…', 'info', 1800);
              T.public.refreshSet(setId).then(function (r2) {
                if (r2 && r2.ok) {
                  T.toast('已同步到最新内容' + (r2.count != null ? '（' + r2.count + ' 题）' : ''), 'success');
                  T.rerender();
                } else {
                  T.toast((r2 && r2.error) || '同步失败，请稍后重试', 'error', 3600);
                }
              });
            }
          }, T.icon('refresh')) : null,
          isPub ? null : el_('button', { class: 'icon-btn', title: '重命名题集', onClick: function () {
            T.prompt({ title: '重命名题集', label: '题集名称', value: set.name, confirmText: '保存' }).then(function (name) {
              if (name == null || name === set.name) return;
              set.name = name;
              T.db.put('sets', set).then(function () { T.toast('已重命名', 'success'); T.rerender(); });
            });
          } }, T.icon('edit')),
          isPub ? null : el_('button', { class: 'icon-btn', title: '导出题集备份', onClick: function () { T.backup.exportSet(setId); } }, T.icon('download')),
          isPub ? null : el_('button', { class: 'icon-btn', title: '删除题集', onClick: function () {
            T.confirm({
              title: '删除题集', danger: true, confirmText: '永久删除',
              message: '将永久删除题集「' + set.name + '」及其 ' + questions.length + ' 道题目，以及相关的答题记录、错题、收藏和练习进度。'
            }).then(function (ok) {
              if (!ok) return;
              Promise.all([
                T.db.getAllByIndex('records', 'by-set', setId),
                T.db.getAllByIndex('mistakes', 'by-set', setId),
                T.db.getAllByIndex('favorites', 'by-set', setId),
                T.db.getAll('sessions')
              ]).then(function (r2) {
                var qSet = {};
                questions.forEach(function (q) { qSet[q.id] = 1; });
                var recordIds = r2[0].map(function (x) { return x.id; });
                var sessionIds = r2[3].filter(function (ss) {
                  if (ss.scope && ss.scope.targetId === setId) return true;
                  return (ss.questionIds || []).some(function (id) { return qSet[id]; });
                }).map(function (ss) { return ss.id; });
                return T.db.run(T.db.stores, 'readwrite', function (t) {
                  t.objectStore('sets').delete(setId);
                  questions.forEach(function (q) { t.objectStore('questions').delete(q.id); });
                  recordIds.forEach(function (id) { t.objectStore('records').delete(id); });
                  r2[1].forEach(function (x) { t.objectStore('mistakes').delete(x.questionId); });
                  r2[2].forEach(function (x) { t.objectStore('favorites').delete(x.questionId); });
                  sessionIds.forEach(function (id) { t.objectStore('sessions').delete(id); });
                });
              }).then(function () {
                T.toast('题集已删除', 'success');
                T.go('#/folder/' + set.folderId);
              });
            });
          } }, T.icon('trash'))));

        /* 题集统计 */
        root.appendChild(el_('div', { class: 'section-head' }, el_('h2', {}, '题集统计')));
        root.appendChild(el_('div', { class: 'stat-grid' },
          statCard('总题数', String(st.questions)),
          statCard('已答题数', String(st.answered)),
          statCard('答对（最近）', String(st.correct), 'is-success'),
          statCard('错题', String(st.mistakes), 'is-danger'),
          statCard('正确率', T.pct(st.accuracy), 'is-primary'),
          statCard('收藏', String(st.favorites)),
          statCard('尝试次数', String(st.attempts)),
          statCard('尝试正确率', T.pct(st.attemptAccuracy))));

        /* 刷题启动器 */
        root.appendChild(el_('div', { class: 'section-head' }, el_('h2', {}, '开始练习')));
        root.appendChild(buildLauncher());

        function buildLauncher() {
          var state = { order: 'seq', quizMode: T.quizModeDefault(), types: new Set(), chapters: new Set(), onlyWrong: false, onlyFav: false, onlyUnanswered: false };
          var typeCounts = {};
          questions.forEach(function (q) { typeCounts[q.type] = (typeCounts[q.type] || 0) + 1; });
          var chapters = {};
          questions.forEach(function (q) {
            var c = q.chapter || '';
            chapters[c] = (chapters[c] || 0) + 1;
          });
          var chapterKeys = Object.keys(chapters).sort();

          var box = el_('div', { class: 'card launcher' });
          var seqBtn = segBtn('顺序', function () { state.order = 'seq'; refresh(); });
          var randBtn = segBtn('随机', function () { state.order = 'random'; refresh(); });
          function segBtn(label, fn) {
            return el_('button', { onClick: fn }, label);
          }
          box.appendChild(el_('div', { class: 'launch-row' },
            el_('span', { class: 'launch-label' }, '顺序'),
            el_('div', { class: 'seg' }, seqBtn, randBtn)));

          /* 练习模式：刷题（即点即判，答对自动下一题） / 做题（选完提交） / 背题（直接看答案） */
          var modeBtns = {};
          var modeSeg = el_('div', { class: 'seg' });
          T.QUIZ_MODES.forEach(function (m) {
            modeBtns[m.key] = el_('button', { title: m.hint, onClick: function () {
              state.quizMode = m.key;
              T.setQuizModeDefault(m.key);
              refresh();
            } }, m.label);
            modeSeg.appendChild(modeBtns[m.key]);
          });
          var modeHint = el_('div', { class: 'launch-mode-hint' }, '');
          box.appendChild(el_('div', { class: 'launch-row launch-row-mode' },
            el_('span', { class: 'launch-label' }, '模式'),
            el_('div', { class: 'launch-mode-box' }, modeSeg, modeHint)));

          /* 题型筛选 */
          var typeList = el_('div', { class: 'launch-types' });
          ['single', 'multiple', 'judge'].forEach(function (t) {
            if (!typeCounts[t]) return;
            var cb = el_('input', { type: 'checkbox' });
            cb.addEventListener('change', function () {
              if (cb.checked) state.types.add(t); else state.types.delete(t);
              refresh();
            });
            typeList.appendChild(el_('label', { class: 'check-line' }, cb, T.typeLabel(t) + '（' + typeCounts[t] + ' 题）'));
          });
          if (typeList.childNodes.length) {
            box.appendChild(el_('div', { class: 'launch-row' }, el_('span', { class: 'launch-label' }, '题型'), typeList));
          }

          /* 章节筛选 */
          if (chapterKeys.length > 1) {
            var chBody = el_('div', { class: 'chapters-body', style: 'display:none' });
            var chToggle = el_('button', {
              class: 'chapters-toggle', onClick: function () {
                var open = chBody.style.display !== 'none';
                chBody.style.display = open ? 'none' : 'block';
                chToggle.replaceChildren(T.icon('filter'), open ? '按章节筛选（' + chapterKeys.length + ' 章）' : '收起', T.icon('chevronDown'));
              }
            }, T.icon('filter'), '按章节筛选（' + chapterKeys.length + ' 章）', T.icon('chevronDown'));
            chapterKeys.forEach(function (c) {
              var cb = el_('input', { type: 'checkbox' });
              cb.addEventListener('change', function () {
                if (cb.checked) state.chapters.add(c); else state.chapters.delete(c);
                refresh();
              });
              chBody.appendChild(el_('label', { class: 'check-line' }, cb, (c === '' ? '（无章节）' : c) + '（' + chapters[c] + ' 题）'));
            });
            box.appendChild(el_('div', { class: 'chapters-box' }, chToggle, chBody));
          }

          /* 范围筛选 */
          var scopeLine = el_('div', { class: 'launch-scopes' });
          function scopeCheck(label, key, title) {
            var cb = el_('input', { type: 'checkbox', title: title });
            cb.addEventListener('change', function () { state[key] = cb.checked; refresh(); });
            scopeLine.appendChild(el_('label', { class: 'check-line' }, cb, label));
          }
          scopeCheck('仅错题', 'onlyWrong', '只练习该范围内的错题');
          scopeCheck('仅收藏', 'onlyFav', '只练习该范围内的收藏题目');
          scopeCheck('仅未答', 'onlyUnanswered', '只练习从未作答过的题目');
          box.appendChild(el_('div', { class: 'launch-row' }, el_('span', { class: 'launch-label' }, '范围'), scopeLine));

          var countEl = el_('span', { class: 'launch-count' }, '…');
          var startBtn = el_('button', { class: 'btn btn-primary btn-lg' }, T.icon('play'), '开始练习');
          startBtn.addEventListener('click', function () {
            T.startQuiz({
              mode: 'set', targetId: setId, order: state.order, quizMode: state.quizMode,
              filters: buildFilters(), label: set.name, origin: '#/set/' + setId
            });
          });
          box.appendChild(el_('div', { class: 'launch-foot' }, startBtn, countEl));

          function buildFilters() {
            var f = {};
            if (state.types.size) f.types = Array.from(state.types);
            if (state.chapters.size) f.chapters = Array.from(state.chapters);
            if (state.onlyWrong) f.onlyWrong = true;
            if (state.onlyFav) f.onlyFav = true;
            if (state.onlyUnanswered) f.onlyUnanswered = true;
            return f;
          }

          var refreshTimer = null;
          function refresh() {
            seqBtn.classList.toggle('active', state.order === 'seq');
            randBtn.classList.toggle('active', state.order === 'random');
            var curMode = null;
            T.QUIZ_MODES.forEach(function (m) {
              modeBtns[m.key].classList.toggle('active', state.quizMode === m.key);
              if (state.quizMode === m.key) curMode = m;
            });
            if (!curMode) curMode = T.QUIZ_MODES[1];
            modeHint.textContent = curMode.hint;
            startBtn.replaceChildren(T.icon('play'), '开始' + curMode.label);
            countEl.textContent = '计算中…';
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(function () {
              T.collectQuestions({ mode: 'set', targetId: setId, filters: buildFilters() }).then(function (qs) {
                countEl.textContent = '筛选后可练 ' + qs.length + ' / ' + questions.length + ' 题';
                startBtn.disabled = !qs.length;
              });
            }, 120);
          }
          refresh();
          return box;
        }

        /* 每题统计 */
        if (st.perQuestion && st.perQuestion.size) {
          var perShown = 0;
          var perBox = el_('div', { class: 'card', style: 'display:none;margin-top:14px' });
          var perToggle = el_('button', {
            class: 'btn btn-ghost', onClick: function () {
              var open = perBox.style.display !== 'none';
              perBox.style.display = open ? 'none' : 'block';
              perToggle.replaceChildren(T.icon('chart'), open ? '查看每题统计' : '收起每题统计');
            }
          }, T.icon('chart'), '查看每题统计');
          root.appendChild(el_('div', { style: 'margin-top:18px' }, perToggle, perBox));
          function renderPerTable() {
            var head = el_('tr', {},
              el_('th', {}, '#'), el_('th', {}, '题干'), el_('th', {}, '题型'),
              el_('th', {}, '答题次数'), el_('th', {}, '答对次数'), el_('th', {}, '最近作答'), el_('th', {}, '状态'));
            var tbl = el_('table', { class: 'data-table' }, el_('thead', {}, head));
            var tbody = el_('tbody', {});
            tbl.appendChild(tbody);
            var LIMIT = 200;
            var slice = questions.slice(0, Math.min(perShown + LIMIT, questions.length));
            slice.forEach(function (q, i) {
              var a = st.perQuestion.get(q.id);
              tbody.appendChild(el_('tr', {},
                el_('td', {}, String(i + 1)),
                el_('td', { class: 'wrap' }, (q.question || '').slice(0, 40) + ((q.question || '').length > 40 ? '…' : '')),
                el_('td', {}, T.typeLabel(q.type)),
                el_('td', {}, a ? String(a.attempts) : '0'),
                el_('td', {}, a ? String(a.correct) : '0'),
                el_('td', {}, a ? T.relTime(a.lastAt) : '—'),
                el_('td', {}, a ? (a.lastCorrect ? el_('span', { class: 'chip chip-ok' }, '最近答对') : el_('span', { class: 'chip chip-danger' }, '最近答错')) : el_('span', { class: 'chip' }, '未答'))));
            });
            perBox.replaceChildren(
              el_('p', { style: 'color:var(--muted);font-size:13px' }, '每题统计基于全部答题记录（重做会累计次数）。'),
              el_('div', { class: 'table-wrap' }, tbl));
            perShown = slice.length;
            if (perShown < questions.length) {
              perBox.appendChild(el_('div', { class: 'load-more' },
                el_('button', { class: 'btn btn-ghost', onClick: renderPerTable }, '显示更多（剩余 ' + (questions.length - perShown) + ' 题）')));
            }
          }
          perBox.addEventListener('DOMNodeInserted', function checkInit() { /* 占位，首次打开时渲染 */ });
          perToggle.addEventListener('click', function () {
            if (perBox.style.display !== 'none' && !perBox.childNodes.length) renderPerTable();
          });
        }

        /* 题目预览 */
        var prevShown = 0;
        var prevBox = el_('div', { class: 'card', style: 'display:none;margin-top:14px' });
        var prevToggle = el_('button', {
          class: 'btn btn-ghost', onClick: function () {
            var open = prevBox.style.display !== 'none';
            prevBox.style.display = open ? 'none' : 'block';
            prevToggle.replaceChildren(T.icon('list'), open ? '浏览题目' : '收起题目列表');
            if (!open && !prevBox.childNodes.length) renderPreview();
          }
        }, T.icon('list'), '浏览题目');
        root.appendChild(el_('div', { style: 'margin-top:10px' }, prevToggle, prevBox));
        function renderPreview() {
          var LIMIT = 100;
          var slice = questions.slice(0, Math.min(prevShown + LIMIT, questions.length));
          prevBox.replaceChildren();
          slice.forEach(function (q, i) {
            var detail = el_('div', { class: 'lib-item-detail', style: 'display:none;margin:0;padding:12px 0' });
            detail.appendChild(T.renderQuestionStatic(q, { showAnswer: true }));
            var head = el_('div', {
              class: 'lib-item-main', onClick: function () {
                detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
              }
            },
              el_('div', { class: 'lib-item-text' }, (i + 1) + '. ' + (q.question || '')),
              el_('div', { class: 'lib-item-meta' },
                el_('span', { class: 'chip chip-type' }, T.typeLabel(q.type)),
                q.chapter ? el_('span', { class: 'chip' }, q.chapter) : null));
            prevBox.appendChild(el_('div', { class: 'lib-item', style: 'margin-bottom:10px' }, head, detail));
          });
          prevShown = slice.length;
          if (prevShown < questions.length) {
            prevBox.appendChild(el_('div', { class: 'load-more' },
              el_('button', { class: 'btn btn-ghost', onClick: renderPreview }, '显示更多（剩余 ' + (questions.length - prevShown) + ' 题）')));
          }
        }

        return root;
      });
      });
    });
  };
})();
