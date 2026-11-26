# 内置公共题库（question-banks/）

放在这个目录下的题库文件会成为**内置公共题库**：部署后所有访问者都会在应用首页下方看到，结构与用户自建题库一致（**科目文件夹 → 题集文件**）。

## 怎么添加 / 修改题库

1. 在 `question-banks/` 下按科目建文件夹，如 `question-banks/病理学/`；
2. 把题库文件放进去，如 `question-banks/病理学/炎症.json`；
   - 文件必须是 **UTF-8 编码的 .json**，格式与应用「使用说明」中的 JSON 题库格式一致
     （根节点为题目数组，或 `{"title": "题集名", "questions": [...]}`；
     每题含 `question / type(single|multiple|judge) / options / answer / explanation / chapter`）；
   - **文件夹名 = 科目名，文件名（去掉 .json）= 题集名**，支持中文；
   - 修改文件名 / 文件夹名 / 移动文件，在访问者端相当于出现一个新题集（旧的不再显示）。
3. 提交推送（网页上传或 git 均可）。**约 1 分钟后** GitHub Action 会自动重新生成
   `question-banks/manifest.json` 并提交，随后应用端即可看到新题库
   （可点首页「内置公共题库」区的「刷新」按钮立即拉取）。

> Action 位置：仓库 **Actions** 页 → 「更新内置题库清单」。也可以在 Actions 页手动
> 选中该 workflow 点击 **Run workflow** 立即执行一次。

## 不使用 GitHub Actions 时

保持 Actions 关闭的话，需要**手动维护** `question-banks/manifest.json`，格式：

```json
{
  "app": "tiku-public",
  "folders": [
    {
      "name": "病理学",
      "sets": [
        { "name": "炎症", "file": "question-banks/病理学/炎症.json", "count": 25 }
      ]
    }
  ]
}
```

`count` 是题目数量（展示用）；也可以在本地装了 Python 的电脑上运行
`python tools/generate_manifest.py` 自动生成后提交。

## 注意事项

- `manifest.json` 是自动生成的文件，正常情况不要手动编辑；
- 每个访问者第一次打开某个公共题集时才会下载该文件（按需缓存）；
- 访问者在该题集上的练习记录、错题、收藏属于他们各自浏览器，与仓库无关；
- 删除某个文件后，Action 会更新清单，访问者端该题集不再显示（历史练习数据不会显示但不删除）。
