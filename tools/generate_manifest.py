#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_manifest.py —— 扫描 question-banks/ 目录，生成清单文件 manifest.json

目录约定：
  question-banks/
    ├── manifest.json          ← 本脚本生成（勿手动修改，除非不用 GitHub Actions）
    ├── <科目名>/
    │     └── <题集名>.json    ← 一个文件 = 一个题集（UTF-8 编码的 JSON 题库）
    └── ...

生成的 manifest.json 会被应用首页读取，用于展示「内置公共题库」。

用法（两种任选其一）：
  1. GitHub Actions 自动运行（见 .github/workflows/update-banks.yml）：
     只要仓库中 question-banks/ 目录有变动，推送后即自动重新生成并提交。
  2. 本地手动运行后把 manifest.json 一起提交：
     python3 tools/generate_manifest.py
"""
import json
import sys
import time
from pathlib import Path


def count_questions(path: Path):
    """读取题库 JSON 并返回题目数量；解析失败时返回错误信息。"""
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None, "文件不是 UTF-8 编码"
    except OSError as e:
        return None, "无法读取文件: %s" % e
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


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    banks_dir = repo_root / "question-banks"
    if not banks_dir.is_dir():
        print("未找到 question-banks/ 目录，生成空清单。")
        folders = []
    else:
        folders = []
        for d in sorted((p for p in banks_dir.iterdir() if p.is_dir()), key=lambda x: x.name):
            sets = []
            for f in sorted(d.rglob("*.json"), key=lambda x: x.name):
                rel = f.relative_to(repo_root).as_posix()
                entry = {"name": f.stem, "file": rel}
                count, error = count_questions(f)
                entry["count"] = count if count is not None else 0
                if error:
                    entry["error"] = error
                    print("  [警告] %s：%s" % (rel, error), file=sys.stderr)
                sets.append(entry)
            if sets:
                folders.append({"name": d.name, "sets": sets})

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
    print("已生成 %s：%d 个科目、%d 个题集、共 %d 题" % (out, len(folders), total_sets, total_q))
    return 0


if __name__ == "__main__":
    sys.exit(main())
