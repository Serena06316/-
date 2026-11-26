/* =====================================================================
   parse.js —— 题库导入与解析
   支持：JSON / TXT / CSV / DOCX(基于 ZIP + DecompressionStream 解析 word/document.xml)
   核心能力：
     - 题目规范化：动态选项数量（不固定 4 个）、single / multiple / judge 题型、
       多种答案写法（标签、文本、布尔、索引、"ABD" 连写、逗号分隔）
     - 数据校验：导入前逐题校验选项与答案合法性，非法题目跳过并给出原因
   ===================================================================== */
(function () {
  'use strict';
  var T = window.T = window.T || {};

  /* ================= 通用工具 ================= */
  function normText(s) { return String(s == null ? '' : s).replace(/\u00a0/g, ' ').trim(); }

  function pickStr(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj[k] != null && typeof obj[k] !== 'object') {
        var s = normText(obj[k]);
        if (s !== '') return String(obj[k]).trim();
      }
    }
    return null;
  }

  var TYPE_MAP = {
    'single': 'single', '单选': 'single', '单选题': 'single', 'singlechoice': 'single', 'radio': 'single', '单项选择': 'single', '单项选择题': 'single',
    'multiple': 'multiple', '多选': 'multiple', '多选题': 'multiple', 'multiplechoice': 'multiple', 'multichoice': 'multiple', 'multi': 'multiple', 'multiselect': 'multiple', 'checkbox': 'multiple', '不定项': 'multiple', '不定项选择': 'multiple', '多项选择': 'multiple', '多项选择题': 'multiple',
    'judge': 'judge', '判断': 'judge', '判断题': 'judge', 'truefalse': 'judge', 'tf': 'judge', 'boolean': 'judge', 'bool': 'judge', 'judgement': 'judge', 'judgment': 'judge', '是非题': 'judge'
  };
  function normalizeType(v) {
    if (v == null) return null;
    var s = normText(v).toLowerCase().replace(/[\s_\-·]/g, '');
    return TYPE_MAP[s] || null;
  }

  var TRUE_WORDS = { '正确': 1, '对': 1, '是': 1, '√': 1, 'correct': 1, 'true': 1, 'right': 1, 'yes': 1, 't': 1, 'y': 1 };
  var FALSE_WORDS = { '错误': 1, '不正确': 1, '错': 1, '否': 1, '×': 1, 'x': 1, 'incorrect': 1, 'false': 1, 'wrong': 1, 'no': 1, 'f': 1, 'n': 1 };

  function isJudgePair(entries) {
    if (entries.length !== 2) return false;
    var a = entries[0].text.toLowerCase();
    var b = entries[1].text.toLowerCase();
    return (TRUE_WORDS[a] && FALSE_WORDS[b]) || (FALSE_WORDS[a] && TRUE_WORDS[b]);
  }

  function genLabel(i) {
    if (i < 26) return String.fromCharCode(65 + i);
    return String(i + 1);
  }

  /* ================= 选项解析 ================= */
  /* 返回 [{label(可空), text}]，label 统一为大写 */
  function parseOptionEntries(rawOptions) {
    var list = null;
    if (Array.isArray(rawOptions)) list = rawOptions;
    else if (typeof rawOptions === 'string') {
      list = rawOptions.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    } else if (rawOptions && typeof rawOptions === 'object') {
      /* {"A":"文本","B":"文本"} 形式 */
      list = Object.keys(rawOptions).map(function (k) { return { label: k, text: rawOptions[k] }; });
    }
    if (!list) return null;
    var entries = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item == null) continue;
      if (typeof item === 'string' || typeof item === 'number') {
        var s = normText(item);
        if (!s) continue;
        var m = s.match(/^([A-Za-z])[\.、:：)）]\s*(.+)$/);
        if (m) entries.push({ label: m[1].toUpperCase(), text: m[2].trim() });
        else entries.push({ label: null, text: s });
      } else if (typeof item === 'object') {
        var text = pickStr(item, ['text', 'content', 'value', 'option']);
        var label = pickStr(item, ['label', 'key', 'sign']);
        if (text == null) {
          var keys = Object.keys(item);
          if (keys.length === 1 && item[keys[0]] != null && typeof item[keys[0]] !== 'object') {
            label = normText(keys[0]);
            text = normText(item[keys[0]]);
          }
        }
        if ((text == null || text === '') && label != null) { text = label; label = null; }
        if (text == null || text === '') continue;
        entries.push({ label: label ? String(label).trim().toUpperCase() : null, text: String(text) });
      }
    }
    return entries;
  }

  /* ================= 答案解析 ================= */
  function answerItems(rawAnswer) {
    if (rawAnswer == null) return null;
    if (typeof rawAnswer === 'boolean') return [rawAnswer ? '√' : '×'];
    if (typeof rawAnswer === 'number') return [rawAnswer];
    if (typeof rawAnswer === 'string') {
      var s = normText(rawAnswer);
      if (!s) return null;
      return [s];
    }
    if (Array.isArray(rawAnswer)) {
      var out = [];
      for (var i = 0; i < rawAnswer.length; i++) {
        var it = rawAnswer[i];
        if (it == null) continue;
        if (typeof it === 'boolean') out.push(it ? '√' : '×');
        else out.push(it);
      }
      return out.length ? out : null;
    }
    return null;
  }

  function mapItemToIndex(it, entries, type) {
    if (typeof it === 'number') {
      if (isInt(it) && it >= 0 && it < entries.length) return it;
      if (isInt(it) && it >= 1 && it <= entries.length) return it - 1;
      return null;
    }
    var s = normText(it);
    if (!s) return null;
    var low = s.toLowerCase();
    var i;
    for (i = 0; i < entries.length; i++) {
      if (entries[i].label && entries[i].label.toLowerCase() === low) return i;
    }
    for (i = 0; i < entries.length; i++) {
      if (entries[i].text.toLowerCase() === low) return i;
    }
    var judgeCtx = (type === 'judge') || isJudgePair(entries);
    if (judgeCtx) {
      var isTrue = !!TRUE_WORDS[low], isFalse = !!FALSE_WORDS[low];
      if (isTrue || isFalse) {
        for (i = 0; i < entries.length; i++) {
          var tl = entries[i].text.toLowerCase();
          if (isTrue && TRUE_WORDS[tl]) return i;
          if (isFalse && FALSE_WORDS[tl]) return i;
        }
      }
    }
    return null;
  }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  function resolveAnswerIndices(rawAnswer, entries, type) {
    var items = answerItems(rawAnswer);
    if (items == null) return { error: '缺少答案' };
    var hasLabels = entries.some(function (e) { return e.label; });
    var labels = entries.map(function (e) { return e.label; });
    var expanded = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (typeof it === 'number') { expanded.push(it); continue; }
      var s = normText(it);
      if (!s) continue;
      /* 含分隔符：拆分 */
      if (s.length > 1 && /[,，、;；\s]+/.test(s)) {
        var parts = s.split(/[,，、;；\s]+/).filter(Boolean);
        if (parts.length > 1) {
          for (var j = 0; j < parts.length; j++) expanded.push(parts[j]);
          continue;
        }
      }
      /* "ABD" 连写：全部字符都是有效选项标签时拆成单字符 */
      if (s.length > 1 && /^[A-Za-z]+$/.test(s)) {
        var chars = s.split('');
        var allLabels = hasLabels && chars.every(function (c) { return labels.indexOf(c.toUpperCase()) >= 0; });
        if (allLabels && type !== 'judge') {
          chars.forEach(function (c) { expanded.push(c); });
          continue;
        }
      }
      expanded.push(s);
    }
    var idxs = [];
    for (var k = 0; k < expanded.length; k++) {
      var idx = mapItemToIndex(expanded[k], entries, type);
      if (idx == null) {
        var disp = typeof expanded[k] === 'number' ? expanded[k] : normText(expanded[k]);
        return { error: '答案 "' + disp + '" 无法匹配到任何选项' };
      }
      if (idxs.indexOf(idx) < 0) idxs.push(idx);
    }
    if (!idxs.length) return { error: '答案为空或无法匹配' };
    return { idxs: idxs };
  }

  /* ================= 单题规范化 ================= */
  /*
    返回 { ok:true, q:{type,question,options,answer,explanation,chapter,rawId}, warnings:[] }
       或 { ok:false, error:"题目 N: 原因" }
  */
  function normalizeQuestion(raw, index) {
    var at = '第 ' + (index + 1) + ' 题';
    var warnings = [];
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: at + '：格式错误（应为对象）' };
    }
    var question = pickStr(raw, ['question', 'title', 'stem', 'q', 'content', '题干', '问题描述']);
    if (!question) return { ok: false, error: at + '：缺少题干' };

    var typeRaw = raw.type != null ? raw.type : (raw['题型'] != null ? raw['题型'] : (raw.qtype != null ? raw.qtype : (raw.kind != null ? raw.kind : null)));
    var type = normalizeType(typeRaw);
    if (typeRaw != null && !type) warnings.push(at + '：未知的题型 "' + normText(typeRaw) + '"，已自动推断');

    var rawOptions = raw.options != null ? raw.options
      : (raw['选项'] != null ? raw['选项']
        : (raw.choices != null ? raw.choices
          : (raw.items != null ? raw.items
            : (raw.opts != null ? raw.opts : null))));
    var entries = parseOptionEntries(rawOptions);
    if (entries == null) entries = [];
    entries = entries.filter(function (e) { return normText(e.text) !== ''; });

    var rawAnswer = raw.answer != null ? raw.answer
      : (raw['答案'] != null ? raw['答案']
        : (raw.correctAnswer != null ? raw.correctAnswer
          : (raw.ans != null ? raw.ans
            : (raw.correct != null ? raw.correct
              : (raw.key != null ? raw.key : (raw.solution != null ? raw.solution : null))))));

    /* 题型推断（未显式给出时） */
    if (!type) {
      if (entries.length === 2 && isJudgePair(entries)) type = 'judge';
      else if (typeof rawAnswer === 'boolean') type = 'judge';
      else if (typeof rawAnswer === 'string') {
        var low = normText(rawAnswer).toLowerCase();
        if (TRUE_WORDS[low] || FALSE_WORDS[low]) type = 'judge';
      }
    }

    /* 判断题：补全或校验选项 */
    if (type === 'judge') {
      if (entries.length === 0) {
        entries = [{ label: 'A', text: '正确' }, { label: 'B', text: '错误' }];
      } else if (entries.length === 1) {
        return { ok: false, error: at + '：判断题需要一对（正确/错误）选项' };
      } else if (entries.length > 2) {
        return { ok: false, error: at + '：判断题只能有 2 个选项（当前 ' + entries.length + ' 个）' };
      }
    }

    if (entries.length < 2) {
      return { ok: false, error: at + '：至少需要 2 个选项（当前 ' + entries.length + ' 个）' };
    }

    var res = resolveAnswerIndices(rawAnswer, entries, type);
    if (res.error) return { ok: false, error: at + '：' + res.error };
    var idxs = res.idxs;

    if (!type) type = idxs.length > 1 ? 'multiple' : 'single';
    if (type === 'single' && idxs.length > 1) {
      return { ok: false, error: at + '：单选题只能有 1 个答案（当前 ' + idxs.length + ' 个）' };
    }
    if (type === 'judge' && idxs.length !== 1) {
      return { ok: false, error: at + '：判断题只能有 1 个答案' };
    }
    if (type === 'multiple' && idxs.length === 1) {
      warnings.push(at + '：多选题只有 1 个答案，请注意核对');
    }

    /* 统一重排标签（A、B、C…），答案按索引映射 */
    var options = entries.map(function (e, i) { return { label: genLabel(i), text: e.text }; });
    var answer = idxs.map(function (i) { return genLabel(i); });

    var rawId = raw.id != null ? raw.id : (raw.qid != null ? raw.qid : (raw['编号'] != null ? raw['编号'] : (raw.no != null ? raw.no : null)));

    return {
      ok: true,
      warnings: warnings,
      q: {
        type: type,
        question: String(question),
        options: options,
        answer: answer,
        explanation: String(pickStr(raw, ['explanation', '解析', 'analysis', '解释', '说明']) || ''),
        chapter: String(pickStr(raw, ['chapter', '章节', 'section', '章']) || ''),
        rawId: rawId != null ? String(rawId) : null
      }
    };
  }

  /* ================= 题库级规范化（去重 + 收集错误） ================= */
  function normalizeBank(rawList, warnings) {
    var questions = [], skipped = [], seen = {};
    for (var i = 0; i < rawList.length; i++) {
      var r;
      try { r = normalizeQuestion(rawList[i], i); }
      catch (e) { r = { ok: false, error: '第 ' + (i + 1) + ' 题：解析异常（' + (e.message || e) + '）' }; }
      if (!r.ok) { skipped.push({ index: i + 1, error: r.error }); continue; }
      (r.warnings || []).forEach(function (w) { warnings.push(w); });
      var q = r.q;
      if (q.rawId != null) {
        if (seen[q.rawId]) {
          skipped.push({ index: i + 1, error: '第 ' + (i + 1) + ' 题：ID "' + q.rawId + '" 重复，仅保留第一条' });
          continue;
        }
        seen[q.rawId] = 1;
      }
      questions.push(q);
    }
    return { questions: questions, skipped: skipped, warnings: warnings };
  }

  function finalizeBank(bank, name, warnings) {
    if (!bank.questions.length) {
      var reasons = bank.skipped.slice(0, 3).map(function (s) { return s.error; }).join('；');
      return {
        ok: false,
        error: '未能解析出有效题目' + (bank.skipped.length ? '（' + bank.skipped.length + ' 条无效，示例：' + reasons + '）' : ''),
        hint: '#/help'
      };
    }
    return {
      ok: true,
      name: name || '未命名题集',
      questions: bank.questions,
      skipped: bank.skipped,
      warnings: warnings
    };
  }

  /* ================= JSON 题库 ================= */
  T.parseJSONBank = function (text, defaultName) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'JSON 解析失败：' + (e.message || e), hint: '#/help' }; }
    var list = null, name = null;
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object') {
      name = pickStr(data, ['title', 'name', 'setName', '题集名称', '题库名称']);
      if (Array.isArray(data.questions)) list = data.questions;
      else if (Array.isArray(data.data)) list = data.data;
      else if (Array.isArray(data.list)) list = data.list;
      else if (Array.isArray(data.items)) list = data.items;
    }
    if (!list || !list.length) {
      return { ok: false, error: 'JSON 结构错误：根节点应为题目数组，或包含 "questions" 数组的对象', hint: '#/help' };
    }
    var warnings = [];
    var bank = normalizeBank(list, warnings);
    return finalizeBank(bank, name || defaultName, warnings);
  };

  /* ================= TXT 题库 ================= */
  /*
    格式说明（详见帮助页）：
      # 题集名称: xxx        （文件头部，可选）
      [章节] xxx / [类型] multiple   （可选标签，带方括号时冒号可省略）
      题干（可多行）
      A. 选项 / A、选项
      答案: B  或  答案：ABD  或  答案：正确
      解析: xxx（可多行）
      ---                （题目分隔线，推荐）
  */
  /* 标签行匹配：支持 "[标签] 值"、"标签: 值"、"标签：值" 三种写法 */
  var TAG_KEYS = {
    type: '题型|类型|type',
    chapter: '章节|chapter|章',
    answer: '正确答案|答案|answer|key',
    expl: '解析|解释|分析|explanation'
  };
  function matchTagLine(t, key) {
    var m = t.match(new RegExp('^\\[\\s*(' + TAG_KEYS[key] + ')\\s*\\]\\s*[:：]?\\s*(.*)$', 'i'));
    if (m) return m[2];
    m = t.match(new RegExp('^(' + TAG_KEYS[key] + ')\\s*[:：]\\s*(.*)$', 'i'));
    if (m) return m[2];
    return null;
  }
  var RE_OPT = /^([A-Za-z])\s*[\.、:：)）]\s*(.+)$/;

  function splitTxtBlocks(lines, start) {
    var blocks = [], cur = [];
    var sawAnswer = false;
    function isSep(t) { return /^(-{3,}|\*{3,}|={3,})$/.test(t); }
    function isNumStem(t) { return /^(?:\d{1,3}|[（(][\d一二三四五六七八九十]+[)）]|[一二三四五六七八九十]{1,3})\s*[\.、)）]/.test(t); }
    function isOption(t) { return /^[A-Za-z]\s*[\.、:：)）]/.test(t); }
    function closeBlock() {
      if (cur.length) blocks.push(cur);
      cur = [];
      sawAnswer = false;
    }
    for (var j = start; j < lines.length; j++) {
      var t = lines[j].trim();
      if (isSep(t)) { closeBlock(); continue; }
      if (!t) { if (sawAnswer) closeBlock(); continue; }
      if (sawAnswer && (isNumStem(t) || isOption(t))) closeBlock();
      var ansV = matchTagLine(t, 'answer');
      if (ansV != null && ansV.trim() !== '') sawAnswer = true;
      cur.push(lines[j]);
    }
    if (cur.length) blocks.push(cur);
    return blocks;
  }

  function parseTxtBlock(lines) {
    var question = null, chapter = null, type = null, answer = null, explanation = null;
    var options = [];
    var mode = 'stem'; /* stem | options | after-answer | explanation */
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var m;
      if ((m = matchTagLine(t, 'type')) != null && m.trim() !== '') { type = m.trim(); continue; }
      if ((m = matchTagLine(t, 'chapter')) != null) { chapter = m.trim(); continue; }
      if ((m = matchTagLine(t, 'answer')) != null && m.trim() !== '') { answer = m.trim(); mode = 'after-answer'; continue; }
      if ((m = matchTagLine(t, 'expl')) != null) { mode = 'explanation'; explanation = m.trim(); continue; }
      if ((m = t.match(RE_OPT))) {
        options.push({ label: m[1], text: m[2].trim() });
        mode = 'options';
        continue;
      }
      if (mode === 'explanation') {
        explanation = explanation ? explanation + '\n' + t : t;
      } else if (mode === 'options' && options.length) {
        options[options.length - 1].text += '\n' + t;
      } else if (mode === 'after-answer') {
        mode = 'explanation';
        explanation = t;
      } else {
        question = question ? question + '\n' + t : t;
      }
    }
    if (!question && !answer && !options.length) return null;
    return {
      question: question || '',
      options: options,
      answer: answer != null ? answer : null,
      explanation: explanation || '',
      chapter: chapter || '',
      type: type || undefined
    };
  }

  T.parseTXTBank = function (text, defaultName) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var lines = text.split(/\r\n|\r|\n/);
    var name = null, i = 0;
    for (; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) continue;
      if (ln.charAt(0) === '#') {
        var m = ln.replace(/^#+\s*/, '').match(/^(?:题集名称|题集|名称|标题|set|title)\s*[:：]\s*(.+)$/i);
        if (m && !name) name = m[1].trim();
        continue;
      }
      break;
    }
    var blocks = splitTxtBlocks(lines, i);
    var raws = [];
    for (var b = 0; b < blocks.length; b++) {
      var raw = parseTxtBlock(blocks[b]);
      if (raw) raws.push(raw);
    }
    if (!raws.length) {
      return { ok: false, error: '未能解析出任何题目。TXT 格式要求：题干一行、选项 "A. 文本"、以 "答案:" 标注答案、题目之间用 "---" 分隔', hint: '#/help' };
    }
    var warnings = [];
    var bank = normalizeBank(raws, warnings);
    return finalizeBank(bank, name || defaultName, warnings);
  };

  /* ================= CSV 题库 ================= */
  function detectDelimiter(firstLine) {
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQ = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine.charAt(i);
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] != null) counts[ch]++;
    }
    var best = ',', max = 0;
    for (var k in counts) {
      if (counts[k] > max) { max = counts[k]; best = k; }
    }
    return best;
  }

  function splitCSVRows(text) {
    var firstLine = text.split(/\r?\n/)[0] || '';
    var delim = detectDelimiter(firstLine);
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n') {
          row.push(field); field = '';
          if (row.length > 1 || row[0] !== '') rows.push(row);
          row = [];
        } else if (c !== '\r') field += c;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
    }
    return rows;
  }

  T.parseCSVBank = function (text, defaultName) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var rows = splitCSVRows(text);
    if (!rows.length) return { ok: false, error: '文件为空' };
    var header = rows[0].map(function (h) { return normText(h).toLowerCase().replace(/\s/g, ''); });
    var col = {}, optionCols = [];
    header.forEach(function (h, idx) {
      if (/^(题干|题目|问题|question|标题|title|stem|内容)$/.test(h)) col.q = idx;
      else if (/^(题型|类型|type)$/.test(h)) col.type = idx;
      else if (/^(答案|正确答案|answer|key)$/.test(h)) col.a = idx;
      else if (/^(解析|解释|分析|explanation)$/.test(h)) col.e = idx;
      else if (/^(章节|章|chapter|section)$/.test(h)) col.c = idx;
      else if (/^[a-z]$/.test(h)) optionCols.push([h.toUpperCase(), idx]);
      else {
        var mm = h.match(/^(?:选项|选择|option|choice)([a-z])$/);
        if (mm) optionCols.push([mm[1].toUpperCase(), idx]);
      }
    });
    if (col.q == null) return { ok: false, error: 'CSV 缺少题干列（表头需包含 "题干" 或 "题目"）', hint: '#/help' };
    if (col.a == null) return { ok: false, error: 'CSV 缺少答案列（表头需包含 "答案" 或 "正确答案"）', hint: '#/help' };
    if (!optionCols.length) return { ok: false, error: 'CSV 缺少选项列（表头需包含 A、B、C 等单字母列名）', hint: '#/help' };
    optionCols.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });

    var raws = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (row.every(function (c) { return normText(c) === ''; })) continue;
      var options = optionCols
        .filter(function (oc) { return normText(row[oc[1]]) !== ''; })
        .map(function (oc) { return { label: oc[0], text: normText(row[oc[1]]) }; });
      raws.push({
        question: normText(row[col.q]),
        options: options,
        answer: normText(row[col.a]),
        type: col.type != null ? normText(row[col.type]) : undefined,
        explanation: col.e != null ? normText(row[col.e]) : '',
        chapter: col.c != null ? normText(row[col.c]) : ''
      });
    }
    if (!raws.length) return { ok: false, error: 'CSV 没有数据行', hint: '#/help' };
    var warnings = [];
    var bank = normalizeBank(raws, warnings);
    return finalizeBank(bank, defaultName, warnings);
  };

  /* ================= DOCX 题库（ZIP + document.xml） ================= */
  function findEOCD(u8) {
    var end = u8.length - 22;
    var min = Math.max(0, u8.length - 65557);
    for (var i = end; i >= min; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持 DecompressionStream，无法解压 DOCX'));
    }
    var blob = new Blob([u8]);
    var stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function extractZipEntry(arrayBuffer, targetPath) {
    var u8 = new Uint8Array(arrayBuffer);
    var dv = new DataView(arrayBuffer);
    var eocd = findEOCD(u8);
    if (eocd < 0) throw new Error('不是有效的 ZIP/DOCX 文件');
    var count = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var p = cdOffset;
    for (var i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOffset = dv.getUint32(p + 42, true);
      var nameBytes = u8.subarray(p + 46, p + 46 + nameLen);
      var name = new TextDecoder('utf-8').decode(nameBytes);
      if (name === targetPath) {
        if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP 本地文件头损坏');
        var lNameLen = dv.getUint16(localOffset + 26, true);
        var lExtraLen = dv.getUint16(localOffset + 28, true);
        var dataStart = localOffset + 30 + lNameLen + lExtraLen;
        var data = u8.subarray(dataStart, dataStart + compSize);
        if (method === 0) return Promise.resolve(data);
        if (method === 8) return inflateRaw(data);
        throw new Error('不支持的 ZIP 压缩方式（method=' + method + '）');
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return Promise.resolve(null);
  }

  function decodeXmlEntities(s) {
    return s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
  }

  function docxXmlToLines(xml) {
    var paras = xml.split(/<\/w:p>/);
    var lines = [];
    for (var i = 0; i < paras.length; i++) {
      var chunks = paras[i].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
      var line = chunks.map(function (c) {
        return decodeXmlEntities(c.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''));
      }).join('');
      if (line.trim()) lines.push(line);
    }
    return lines.join('\n');
  }

  T.parseDOCXBank = function (arrayBuffer, defaultName) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.resolve({
        ok: false,
        error: '当前浏览器不支持解析 DOCX（需要较新的 Chrome/Edge/Firefox/Safari）。请将内容复制到 TXT 文件导入',
        hint: '#/help'
      });
    }
    return extractZipEntry(arrayBuffer, 'word/document.xml').then(function (data) {
      if (data == null) {
        return { ok: false, error: '不是有效的 .docx 文件（未找到 word/document.xml）。注意：不支持旧版 .doc 二进制格式', hint: '#/help' };
      }
      var xml = new TextDecoder('utf-8').decode(data);
      var text = docxXmlToLines(xml);
      if (!text.trim()) return { ok: false, error: 'DOCX 中没有可读取的文本', hint: '#/help' };
      return T.parseTXTBank(text, defaultName);
    }).catch(function (e) {
      return { ok: false, error: 'DOCX 解析失败：' + (e.message || e), hint: '#/help' };
    });
  };

  /* ================= 文件入口 ================= */
  T.parseQuestionFile = function (file) {
    var base = (file.name || '').replace(/\.[^.]+$/, '') || '未命名题集';
    var mm = (file.name || '').match(/\.([a-zA-Z0-9]+)$/);
    var ext = mm ? mm[1].toLowerCase() : '';
    return Promise.resolve().then(function () {
      if (ext === 'json') return file.text().then(function (t) { return T.parseJSONBank(t, base); });
      if (ext === 'txt' || ext === 'text') return file.text().then(function (t) { return T.parseTXTBank(t, base); });
      if (ext === 'csv') return file.text().then(function (t) { return T.parseCSVBank(t, base); });
      if (ext === 'docx') return file.arrayBuffer().then(function (b) { return T.parseDOCXBank(b, base); });
      if (ext === 'doc') return { ok: false, error: '不支持旧版 .doc 二进制格式，请在 Word 中另存为 .docx（或复制内容到 TXT）', hint: '#/help' };
      return { ok: false, error: '不支持的文件格式 ".' + ext + '"（支持 .json / .txt / .csv / .docx）', hint: '#/help' };
    }).catch(function (e) {
      return { ok: false, error: '读取文件失败：' + (e.message || e) };
    }).then(function (r) {
      if (r && r.ok) r.sourceName = file.name || '';
      return r;
    });
  };
})();
