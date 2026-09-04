# 验证闭环与避坑清单

**没有验证的压缩 = 未交付。** 压缩改的是二进制资产，出问题的发现成本远高于压缩本身。

## 四步验证

1. **git 范围确认**：`git status` / `git diff --stat`——改动应仅图片文件（或与用户确认过的辅助文件）；混入预期外文件立即排查
2. **独立像素校验（无损通道必做）**：不信压缩工具自己的校验，用独立解码器对旧文件（git 恢复或压缩前备份）与新文件分别展开到 **RGBA 真彩缓冲**逐像素比对（调色板图先经 PLTE+tRNS 映射回真彩）。**macOS sips PNG→TIFF 后 cmp 不能作为判据**；**字节流/索引级比对也不能**（palette 重排与位深优化是合法无损变换，见避坑清单）
3. **构建验证**：`npm run build` 跑通（老构建链可能锁定旧 Node 版本，如 16）——确认 webpack 资源管线正常、产物 contenthash 更新
4. **发布后 CDN 抽查**：用构建/发布日志里**带 contenthash 的资源名**（裸文件名 URL 不存在）；抽查 HTTP 200 且字节数与本地 `stat -f%z` 一致

## 避坑清单（全部实战踩过或核实过）

| 坑 | 现象 | 规则 |
|---|---|---|
| eXIf Orientation 丢失 | 剔除 eXIf 后浏览器渲染方向变了（`image-orientation: from-image` 默认生效） | 通用工具/脚本**永不剔 eXIf**；剥 EXIF 类操作（jpegtran `-copy none`）对含方向标记的照片禁用 |
| sips 假阳性 | PNG→TIFF 全文件 cmp 报大量差异，实际像素一致（EXIF 被转写进 TIFF IFD 造成字节偏移） | 像素一致性裁决用独立 PNG 解码器双文件比对，不用 sips/ImageMagick 转格式后 cmp |
| 校验基准错误（字节级假阳性） | 无损优化后逐字节比对报 FAIL——oxipng/pngquant 的 palette 重排（索引变、RGB 映射不变）与调色板位深优化（8→4/2/1-bit 打包）是合法无损变换 | 比对统一在 **RGBA 渲染语义**层做：两侧展开到 RGBA（PLTE+tRNS 映射）逐像素比对，允许 colorType/bitDepth 差异，只断言尺寸+RGBA 一致（视频签到二轮实测：字节级比对 14 张假阳性，RGBA 层 37/37 全一致） |
| `.min` 后缀不生效 | TinyPNG 扩展默认生成 `xxx.min.png`，代码引用原文件名，压缩不生效且残留垃圾 | 扩展必开 `tinypng.forceOverwrite: true` |
| 有损冒充无损 | 「压缩了」但像素变了，违反零损失诉求 | 有损通道执行前显式告知并获确认；无损通道写盘前像素逐字节校验 |
| 小图硬压 | <2KB 图收益几十字节，浪费配额/时间 | 设跳过阈值（<2KB skip） |
| 重复压缩 | 同通道跑两遍，第二遍无收益还耗配额 | 每素材每通道一遍；流水线方向单向（无损 → 量化 → 可选无损收尾） |
| dry-run 也计数 | 「先试试」结果 TinyPNG 配额被吃 | 上传即计数，试跑按真跑规划配额（`--top N` 优先压大图） |
| nvm node 不在 PATH | 非交互 shell `node: command not found` | 绝对路径 `~/.nvm/versions/node/vX/bin/node` 或先 `source ~/.nvm/nvm.sh` |
| Node 版本与构建不匹配 | 新 Node 跑老构建链报 `fs.existsSync is not a function` 之类奇错；构建/发布 CLI 不在默认 PATH | 按构建链要求切对应 Node 大版本（`export PATH="$HOME/.nvm/versions/node/vX.Y.Z/bin:$PATH"`）；非交互 shell 用绝对路径 |

## 压缩报告模板

```
共 N 张，优化 M 张：before → after（-pct%）
逐图：OK/KEEP/SKIP  原体积 -> 新体积 (-pct%)  路径 [原因]
  KEEP = 已达该层极限；SKIP = 质量保护阀触发 / 结果更大
有损通道额外输出差异量化：最大色差 / 变化像素占比 / >8 色差占比
```

报告连同验证结果一起交付；发布类任务附 CDN 抽查证据（资源 URL + HTTP 状态 + 字节数对照）。
