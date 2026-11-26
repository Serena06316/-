/* =====================================================================
   views-data.js —— 数据管理（备份/恢复/存储/清空）与使用说明（帮助页）
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};
  T.views = T.views || {};
  var el = T.el;

  /* ================= 数据管理页 ================= */
  T.views.data = function () {
    var root = el('div', { class: 'view-data' });
    var stats = { folders: 0, sets: 0, questions: 0, records: 0, mistakes: 0, favorites: 0 };

    root.appendChild(el('div', { class: 'section-head', style: 'margin-top:0' },
      el('span', { class: 'quick-ico' }, T.icon('database')),
      el('h1', { style: 'margin:0' }, '备份与数据管理')));

    /* 重要说明 */
    root.appendChild(el('div', { class: 'help-notice' },
      T.icon('alertCircle'),
      el('div', {},
        el('b', {}, '数据保存在当前浏览器（IndexedDB）中，不会自动同步到其他设备或浏览器。'),
        '清除浏览器数据、使用隐私模式或更换设备都会导致数据丢失，请定期导出备份。')));

    /* 备份导出 */
    var exportBlock = el('div', { class: 'card data-block' },
      el('h2', {}, '导出备份'),
      el('p', { style: 'color:var(--text-2)' }, '备份文件为 JSON 格式，包含文件夹、题集、题目、答题记录、错题、收藏与练习进度。'),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        el('button', { class: 'btn btn-primary', onClick: function () { T.backup.exportFull(); } }, T.icon('download'), '导出全部数据')),
      el('div', { class: 'storage-line', id: 'data-stats' }, '统计加载中…'));
    root.appendChild(exportBlock);

    /* 单文件夹导出 */
    var folderList = el('div', { class: 'folder-export-list' });
    root.appendChild(el('div', { class: 'card data-block' },
      el('h2', {}, '按文件夹导出'),
      el('p', { style: 'color:var(--text-2)' }, '导出单个文件夹及其全部题集、题目与相关记录，可导入到其他浏览器。'),
      folderList));

    /* 导入备份 */
    var fileInput = el('input', {
      type: 'file', accept: '.json,application/json', style: 'display:none'
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) importBackupFlow(fileInput.files[0]);
      fileInput.value = '';
    });
    root.appendChild(fileInput);

    var dz = el('div', {
      class: 'dropzone', role: 'button', tabindex: '0', onClick: function () { fileInput.click(); }
    },
      T.icon('upload', 'icon-lg'),
      el('div', { class: 'dropzone-title' }, '点击选择备份文件，或拖拽到此处'),
      el('div', { class: 'dropzone-sub' }, '支持完整备份 / 文件夹备份 / 题集备份三类 JSON 文件'));
    function onDragOver(e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); }
    function onDragLeave(e) { if (e.target === dz) dz.classList.remove('drag'); }
    function onDrop(e) {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importBackupFlow(f);
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

    root.appendChild(el('div', { class: 'card data-block' },
      el('h2', {}, '导入备份 / 恢复数据'),
      el('p', { style: 'color:var(--text-2)' },
        '完整备份会', el('b', {}, '替换本浏览器中的全部现有数据'), '；文件夹/题集备份会作为新内容添加（ID 自动重映射，不会覆盖现有数据）。'),
      el('p', { style: 'color:var(--muted);font-size:13px' }, '注意：普通题库文件（JSON/TXT/CSV/DOCX）请进入文件夹后导入，此处仅接受备份文件。恢复操作在单个数据库事务中完成，避免写入一半损坏数据。'),
      dz));

    /* 存储占用 */
    var storageLine = el('div', { class: 'storage-line' }, '存储占用查询中…');
    root.appendChild(el('div', { class: 'card data-block' },
      el('h2', {}, '存储占用'),
      storageLine,
      el('p', { style: 'color:var(--muted);font-size:12.5px;margin:8px 0 0' }, '数据保存在本浏览器的 IndexedDB 中，占用浏览器为该站点分配的存储空间。')));
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        storageLine.replaceChildren(
          T.icon('database'),
          el('span', {}, '已使用 ' + T.fmtBytes(est.usage) + ' / 可用约 ' + T.fmtBytes(est.quota)));
      }).catch(function () {
        storageLine.textContent = '无法查询存储占用';
      });
    } else {
      storageLine.textContent = '当前浏览器不支持查询存储占用';
    }

    /* 危险区 */
    root.appendChild(el('div', { class: 'card data-block danger-zone' },
      el('h2', {}, '危险操作'),
      el('p', { style: 'color:var(--text-2)' }, '清空本浏览器中保存的全部数据（不可撤销）。建议先导出完整备份。'),
      el('button', {
        class: 'btn btn-danger', onClick: function () {
          T.confirm({
            title: '清空全部数据',
            danger: true, confirmText: '确认清空',
            message: '将删除全部文件夹、题集、题目、答题记录、错题、收藏与练习进度。此操作不可撤销，确定继续吗？'
          }).then(function (ok) {
            if (!ok) return;
            return T.confirm({
              title: '再次确认',
              danger: true, confirmText: '我已了解后果，清空',
              message: '这将永久删除所有本地数据。若未备份，数据将无法恢复。'
            }).then(function (ok2) {
              if (!ok2) return;
              T.backup.clearAll().then(function () {
                T.toast('数据已清空', 'success');
                T.rerender();
              }).catch(function (e) { T.toast('清空失败：' + (e.message || e), 'error'); });
            });
          });
        }
      }, T.icon('trash'), '清空全部数据')));

    /* 加载统计与文件夹列表 */
    T.db.count('folders').then(function (n) { stats.folders = n; fillStats(); });
    T.db.count('sets').then(function (n) { stats.sets = n; fillStats(); });
    T.db.count('questions').then(function (n) { stats.questions = n; fillStats(); });
    T.db.count('records').then(function (n) { stats.records = n; fillStats(); });
    T.db.count('mistakes').then(function (n) { stats.mistakes = n; fillStats(); });
    T.db.count('favorites').then(function (n) { stats.favorites = n; fillStats(); });
    function fillStats() {
      var node = root.querySelector('#data-stats');
      if (node) {
        node.replaceChildren(
          T.icon('chart'),
          el('span', {}, '当前数据：' + stats.folders + ' 个文件夹 · ' + stats.sets + ' 个题集 · ' +
            stats.questions + ' 道题目 · ' + stats.records + ' 条答题记录 · ' +
            stats.mistakes + ' 条错题 · ' + stats.favorites + ' 条收藏'));
      }
    }

    T.db.getAll('folders').then(function (folders) {
      folders.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      if (!folders.length) {
        folderList.replaceChildren(el('p', { style: 'color:var(--muted)' }, '还没有文件夹。'));
        return;
      }
      folderList.replaceChildren();
      folders.forEach(function (f) {
        folderList.appendChild(el('div', { class: 'folder-export-row' },
          T.icon('folder'),
          el('span', { class: 'name' }, f.name),
          el('button', { class: 'btn btn-ghost btn-sm', onClick: function () { T.backup.exportFolder(f.id); } }, T.icon('download'), '导出')));
      });
    });

    /* 备份导入流程 */
    function importBackupFlow(file) {
      file.text().then(function (text) {
        var data;
        try { data = JSON.parse(text); }
        catch (e) { T.toast('导入失败：不是有效的 JSON 文件（' + (e.message || e) + '）', 'error', 4200); return; }
        var r = T.backup.validateBackup(data);
        if (!r.ok) { T.toast('导入失败：' + r.error, 'error', 4200); return; }

        if (r.kind === 'full') {
          T.confirm({
            title: '恢复完整备份',
            danger: true, confirmText: '替换并恢复',
            message: '备份内容：' + r.summary + '。\n\n恢复将清空本浏览器当前全部数据并写入备份内容。继续吗？'
          }).then(function (ok) {
            if (!ok) return;
            T.backup.restoreFull(r.payload).then(function (res) {
              T.toast('恢复完成：' + res.folders + ' 个文件夹、' + res.sets + ' 个题集、' + res.questions + ' 道题目', 'success', 4200);
              T.rerender();
            }).catch(function (e) { T.toast('恢复失败：' + (e.message || e), 'error', 5000); });
          });
        } else if (r.kind === 'folder') {
          T.confirm({
            title: '导入文件夹备份',
            confirmText: '导入',
            message: '将导入文件夹「' + r.name + '」（' + r.sets + ' 个题集、' + r.questions + ' 道题目）及其相关答题记录、错题与收藏，作为新文件夹添加，不影响现有数据。'
          }).then(function (ok) {
            if (!ok) return;
            T.backup.importFolder(r.payload).then(function (res) {
              T.toast('已导入文件夹「' + res.name + '」：' + res.sets + ' 个题集、' + res.questions + ' 道题目', 'success', 4200);
              T.rerender();
            }).catch(function (e) { T.toast('导入失败：' + (e.message || e), 'error', 5000); });
          });
        } else {
          /* 题集备份：选择目标文件夹 */
          T.db.getAll('folders').then(function (folders) {
            folders.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
            var choices = folders.map(function (f) {
              return { key: f.id, label: '导入到「' + f.name + '」', desc: '作为新题集添加到该文件夹' };
            });
            choices.push({ key: '__new__', label: '创建新文件夹并导入', desc: '将创建一个新文件夹存放该题集' });
            return T.choice({
              title: '导入题集备份',
              message: '题集「' + r.name + '」（' + r.questions + ' 道题）需要指定导入的目标文件夹：',
              choices: choices
            }).then(function (pick) {
              if (!pick) return null;
              if (pick === '__new__') {
                return T.prompt({
                  title: '创建新文件夹', label: '文件夹名称',
                  placeholder: '例如：病理学', confirmText: '创建并导入'
                }).then(function (name) {
                  if (name == null) return null;
                  var nf = { id: T.uuid(), name: name, createdAt: Date.now() };
                  return T.db.put('folders', nf).then(function () { return nf.id; });
                });
              }
              return pick;
            });
          }).then(function (folderId) {
            if (!folderId) return;
            T.backup.importSet(r.payload, folderId).then(function (res) {
              T.toast('已导入题集「' + res.name + '」：' + res.questions + ' 道题目', 'success', 4200);
              T.rerender();
            }).catch(function (e) { T.toast('导入失败：' + (e.message || e), 'error', 5000); });
          });
        }
      }).catch(function (e) {
        T.toast('读取文件失败：' + (e.message || e), 'error');
      });
    }

    return Promise.resolve(root);
  };

  /* ================= 帮助页 ================= */
  T.views.help = function () {
    var root = el('div', { class: 'view-help', style: 'max-width:820px;margin:0 auto' });
    root.appendChild(el('div', { class: 'section-head', style: 'margin-top:0' },
      el('span', { class: 'quick-ico is-ok' }, T.icon('helpCircle')),
      el('h1', { style: 'margin:0' }, '使用说明')));

    function section(icon, title) {
      var s = el('div', { class: 'help-section card' });
      s.appendChild(el('h2', {}, T.icon(icon), title));
      root.appendChild(s);
      return s;
    }
    function pre(s, text) {
      s.appendChild(el('pre', { class: 'code' }, text));
    }
    function p(s, text) { s.appendChild(el('p', {}, text)); }
    function ul(s, items) {
      var u = el('ul', {});
      items.forEach(function (it) { u.appendChild(el('li', {}, it)); });
      s.appendChild(u);
    }

    /* 快速上手 */
    var s1 = section('play', '快速上手');
    ul(s1, [
      '首页「创建文件夹」建立课程分类（如：病理学），文件夹数量与命名不限。',
      '进入文件夹，点击导入区选择 JSON / TXT / CSV / DOCX 题库文件，或直接拖拽、粘贴内容；每个文件成为一个独立题集。',
      '点击题集卡片上的「刷题」，或点击「刷整个文件夹」练习该文件夹全部题目。',
      '答错的题自动进入「错题本」，点星标可收藏；支持顺序、随机、仅错题、仅收藏、仅未答、按题型与章节筛选。',
      '右上角可切换日间 / 夜间主题；「备份与数据管理」可导出全部数据或单个文件夹 / 题集。'
    ]);

    /* JSON 格式 */
    var s2 = section('file', '题库文件格式：JSON（推荐）');
    p(s2, '根节点为对象（可含 title 作为默认题集名）或直接的题目数组。每题结构如下，字段说明：');
    ul(s2, [
      'id：题目唯一标识（同一文件内重复会被跳过，仅保留第一条）。',
      'type：题型，single（单选）/ multiple（多选）/ judge（判断）。省略时自动推断。',
      'question：题干，支持换行（\\n）。',
      'options：选项数组，数量任意（2 个、5 个、8 个……自动适配），label 可省略（自动按 A、B、C… 编号）。',
      'answer：答案，统一为数组，元素为选项标签，如 ["B"] 或 ["A","D"]；也兼容 "ABD"、"B" 字符串、布尔值（判断题）等写法。',
      'explanation：解析，可空。chapter：章节，可空。'
    ]);
    pre(s2,
'{\n' +
'  "title": "病理学·第二章 炎症",\n' +
'  "questions": [\n' +
'    {\n' +
'      "id": "q001",\n' +
'      "type": "single",\n' +
'      "question": "炎症最核心的基本病理变化是？",\n' +
'      "options": [\n' + 
'        { "label": "A", "text": "变质" },\n' +
'        { "label": "B", "text": "渗出" },\n' +
'        { "label": "C", "text": "增生" },\n' +
'        { "label": "D", "text": "坏死" }\n' +
'      ],\n' +
'      "answer": ["B"],\n' +
'      "explanation": "炎症的核心是血管反应渗出。",\n' +
'      "chapter": "炎症"\n' +
'    },\n' +
'    {\n' +
'      "id": "q002",\n' +
'      "type": "multiple",\n' +
'      "question": "炎症的基本病理变化包括？",\n' +
'      "options": [\n' +
'        { "text": "变质" }, { "text": "渗出" }, { "text": "增生" },\n' +
'        { "text": "坏死" }, { "text": "钙化" }\n' +
'      ],\n' +
'      "answer": ["A", "B", "C"]\n' +
'    },\n' +
'    {\n' +
'      "id": "q003",\n' +
'      "type": "judge",\n' +
'      "question": "渗出属于炎症的基本病理变化。",\n' +
'      "answer": ["A"]\n' +
'    }\n' +
'  ]\n' +
'}');
    p(s2, '判断题可以只写题干和答案（选项自动补全为 A.正确 / B.错误），answer 也兼容 "正确"、"错误"、true / false、T / F 等写法。');

    /* TXT 格式 */
    var s3 = section('file', '题库文件格式：TXT');
    p(s3, '纯文本格式，便于快速整理。要点：');
    ul(s3, [
      '文件开头可用 “# 题集名称: xxx” 声明题集名（否则使用文件名）。',
      '每题以 “---” 单独一行分隔（推荐）；也可用空行分隔。',
      '[章节] / [类型] 标签行可选，类型可写：单选/多选/判断/single/multiple/judge，省略则自动推断。',
      '选项每行一个，写作 “A. 选项文字” 或 “A、选项文字”；标签连续编号即可，数量不限。',
      '答案行以 “答案:” 开头，多选可写 “答案: ABD”，判断题可写 “答案: 正确”。',
      '解析行以 “解析:” 开头，可换行续写。'
    ]);
    pre(s3,
'# 题集名称: 病理学·第三章 肿瘤\n' +
'[章节] 肿瘤\n' +
'下列哪项属于恶性肿瘤？\n' +
'A. 脂肪瘤\n' +
'B. 纤维瘤\n' +
'C. 脂肪肉瘤\n' +
'D. 血管瘤\n' +
'答案: C\n' +
'解析: 脂肪肉瘤为恶性肿瘤，其余为良性肿瘤。\n' +
'---\n' +
'[类型] 多选\n' +
'良性肿瘤包括\n' +
'A. 脂肪瘤\n' +
'B. 纤维瘤\n' +
'C. 脂肪肉瘤\n' +
'D. 血管瘤\n' +
'答案: ABD\n' +
'---\n' +
'[类型] 判断\n' +
'转移是恶性肿瘤的重要特征。\n' +
'答案: 正确');

    /* CSV 格式 */
    var s4 = section('file', '题库文件格式：CSV');
    p(s4, '第一行为表头：题干、题型（可选）、选项列（单字母 A、B、C……数量不限）、答案、解析（可选）、章节（可选）。含逗号的字段用英文双引号包裹。');
    pre(s4,
'题干,题型,A,B,C,D,E,答案,解析,章节\n' +
'良性肿瘤包括,多选,脂肪瘤,纤维瘤,脂肪肉瘤,血管瘤,鳞状细胞癌,ABD,脂肪肉瘤与鳞状细胞癌为恶性,肿瘤\n' +
'恶性肿瘤的重要特征是转移,判断,,,,,,,本题考查肿瘤特性,肿瘤');
    p(s4, '判断题行只需题干与答案（答案写“正确/错误”），选项列留空即可。');

    /* DOCX */
    var s5 = section('file', '题库文件格式：DOCX');
    ul(s5, [
      '支持 .docx（Word 2007+ 格式），按 TXT 格式规则解析段落文字。',
      '不支持旧版 .doc 二进制格式，请在 Word 中另存为 .docx 或复制内容到 TXT。',
      '解析 DOCX 需要浏览器支持 DecompressionStream（Chrome/Edge 80+、Firefox 113+、Safari 16.4+）。若提示不支持，请改用 TXT/JSON/CSV。'
    ]);

    /* 导入规则 */
    var s6 = section('upload', '导入规则与重复处理');
    ul(s6, [
      '一次可选择多个文件，或拖拽多个文件，每个文件分别创建独立题集。',
      '导入前逐题校验：缺少题干、选项不足 2 个、答案无法匹配选项、单选题多答案等非法题目会被跳并给出原因；其余正常导入，不影响已有数据。',
      '导入的题集默认使用文件名（JSON 可用 title 覆盖），可随时重命名。',
      '同名题集导入时会询问：自动改名新建 / 合并到现有题集（题干、选项、答案完全相同的题目跳过）/ 跳过。',
      '导入失败的文件不会写入任何数据。'
    ]);

    /* 刷题说明 */
    var s7 = section('play', '刷题与进度');
    ul(s7, [
      '刷题范围：单个题集、整个文件夹、错题本、收藏夹。',
      '模式：顺序 / 随机；可按题型、章节筛选，或仅错题、仅收藏、仅未答。',
      '多选题需选齐全部正确选项才判对（与选择顺序无关）；判断题为两选项单选。',
      '提交后显示对错、正确答案与解析；可“重做”（历史记录保留，计入尝试次数）。',
      '每题提交一次计入一次答题记录，重复提交会被阻止。',
      '底部答题卡可跳转任意题目；退出自动保存进度，再次开始时询问是否恢复。',
      '键盘快捷键：数字键选选项、Enter 提交/下一题、左右方向键切题。'
    ]);

    /* 备份说明 */
    var s8 = section('database', '备份与恢复');
    ul(s8, [
      '备份范围：文件夹、题集、题目、答题记录、错题、收藏、练习进度。',
      '「数据管理」页可导出全部数据，或单个文件夹 / 单个题集（也可在文件夹页、题集页导出）。',
      '导入备份文件时自动识别类型：完整备份将替换全部数据（恢复前确认，事务内完成）；文件夹 / 题集备份作为新内容添加，不覆盖现有数据。',
      '普通题库导入与备份恢复严格区分：题库文件不会覆盖答题记录、收藏或错题。',
      '备份 JSON 可跨设备使用：在新设备打开本应用，进入「数据管理」导入即可。'
    ]);

    /* 数据存储说明 */
    var s9 = section('database', '数据存储说明');
    root.appendChild(el('div', { class: 'help-notice' },
      T.icon('alertCircle'),
      el('div', {}, '本地数据库无法自动同步到其他设备或浏览器。换设备、换浏览器、清除浏览器数据都会导致数据“消失”，请通过备份文件迁移或恢复。')));
    ul(s9, [
      '所有数据保存在当前浏览器（本站点源）的 IndexedDB 中，不上传任何服务器。',
      '刷新、关闭网页、重新打开浏览器后数据仍在。',
      '浏览器“清除站点数据 / 浏览记录”会删除 IndexedDB 数据。',
      '无痕/隐私模式下关闭窗口后数据通常会被清除。'
    ]);

    /* 主题 */
    var s10 = section('sun', '主题');
    p(s10, '应用默认跟随系统的日间 / 夜间设置，点击右上角太阳/月亮图标可手动切换，选择会记住。刷新页面后仍保持所选主题。');

    /* 部署 */
    var s11 = section('upload', '关于 GitHub Pages 部署');
    p(s11, '本项目为纯静态文件（HTML/CSS/JS），无需构建，可直接部署到 GitHub Pages。完整步骤见项目根目录的 README.md。');
    p(s11, '本地测试建议通过 HTTP 访问（例如在项目目录运行 python3 -m http.server 8000 后访问 http://localhost:8000）；直接双击 index.html 在部分浏览器中可能无法使用本地存储。');

    return Promise.resolve(root);
  };
})();
