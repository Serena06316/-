#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_manifest.py —— 扫描 question-banks/ 目录，生成清单文件 manifest.json

目录约定：
  question-banks/
    ├── manifest.json          ← 本脚本生成（勿手动修改，除非不用 GitHub Actions）
    ├── <科目名>/
    │     └── <题集名>.json     ← 一个文件 = 一个题集（支持 .json / .txt / .csv / .docx）
    └── <题集名>.json           ← 直接放在 question-banks/ 下会归入「未分类」

生成的 manifest.json 会被应用首页读取，用于展示「内置公共题库」。
说明：应用在没有 manifest.json 时也能通过 GitHub 接口自动发现题库文件，
清单是为了离线/网络受限环境下更稳定而保留的备用方式。

用法（两种任选其一）：
  1. GitHub Actions 自动运行（见 .github/workflows/update-banks.yml）：
     只要仓库中 question-banks/ 目录有变动，推送后即自动重新生成并提交。
  2. 本地手动运行后把 manifest.json 一起提交：
     python3 tools/generate_manifest.py
"""
import json
import re
import sys
import time
from pathlib import Path

BANK_EXTS = {".json", ".txt", ".csv", ".docx"}
ANSWER_RE = re.compile(r"^\s*(?:正确答案|答案|answer|key)\s*[:：]", re.IGNORECASE)


def count_questions(path: Path):
    """估算题库文件中的题目数量；无法确定时返回 (None, None)。"""
    ext = path.suffix.lower()
    if ext == ".docx":
        return None, None  # 二进制格式不在此处解析
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None, "文件不是 UTF-8 编码"
    except OSError as e:
        return None, "无法读取文件: %s" % e
    if ext == ".json":
        try:
            data = json.loads(text)
        except ValueError as e:
            return None, "JSON 解析失败: %s" % e
        if isinstance(data, list):
            return len(data), None
        if isinstance(data, dict):
            for key in ("questions", "data", "list", "items"):
                if isinstance(data.get(key), list):
                    return len(data[key]), None
            return None, "JSON 结构不符合题库格式（应为题目数组，或含 questions 数组的对象）"
        return None, "JSON 根节点应为数组或对象"
    if ext == ".csv":
        rows = [line for line in text.splitlines() if line.strip()]
        return max(0, len(rows) - 1), None  # 去掉表头
    if ext == ".txt":
        return len(ANSWER_RE.findall(text)), None  # 按「答案:」行数估算
    return None, None


def bank_files(folder: Path):
    files = [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in BANK_EXTS]
    return sorted(files, key=lambda x: x.name)


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    banks_dir = repo_root / "question-banks"
    folders = []
    if banks_dir.is_dir():
        by_subject = {}  # 科目名 → sets 列表
        order = []

        def add_set(subject: str, entry: dict):
            if subject not in by_subject:
                by_subject[subject] = []
                order.append(subject)
            by_subject[subject].append(entry)

        for f in bank_files(banks_dir):
            if f.name == "manifest.json" and f.parent == banks_dir:
                continue  # 清单本身不是题库
            if f.stem.lower() == "readme":
                continue  # 忽略 README
            rel = f.relative_to(repo_root).as_posix()
            subject = f.relative_to(banks_dir).parts[0]
            if f.parent == banks_dir:
                subject = "未分类"  # 直接放在 question-banks/ 下的文件
            entry = {"name": f.stem, "file": rel}
            count, error = count_questions(f)
            if count is not None:
                entry["count"] = count
            if error:
                entry["error"] = error
                print("  [警告] %s：%s" % (rel, error), file=sys.stderr)
            add_set(subject, entry)

        folders = [{"name": s, "sets": by_subject[s]} for s in sorted(order)]

    manifest = {
        "app": "tiku-public",
        "generatedAt": int(time.time() * 1000),
        "folders": folders,
    }
    out = banks_dir / "manifest.json"
    banks_dir.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_sets = sum(len(f["sets"]) for f in folders)
    total_q = sum(s.get("count", 0) for f in folders for s in f["sets"])
    print("已生成 %s：%d 个科目、%d 个题集、约 %d 题" % (out, len(folders), total_sets, total_q))
    return 0


if __name__ == "__main__":
    sys.exit(main())
