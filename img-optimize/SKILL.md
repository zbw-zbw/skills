---
name: img-optimize
version: 1.1.0
description: 图片压缩最佳实践：按「质量档位 × 格式 × 环境」三步分流到成熟工具（pngquant/oxipng/jpegtran/cwebp/svgo/TinyPNG），PNG 两阶段流水线（无损打底+量化收尾）经 39 张实战闭环验证 -71%，含验证闭环与断网纯 Node 兜底脚本。Use when 压缩/优化/瘦身项目图片素材、图片体积过大、接入 TinyPNG、给项目搭一键 imgmin 命令时。触发词：压缩图片、图片优化、素材瘦身、无损压缩、肉眼无损、TinyPNG、pngquant、oxipng、imgmin、图片压缩最佳实践。
compatibility: "任意项目与平台（macOS/Linux/Windows）；本地通道需装 CLI 工具（安装矩阵见 decision-matrix.md）或 Node ≥16（断网兑底脚本，crc32 已内置低版本 polyfill）；TinyPNG 通道需外网与 API key"
license: MIT
allowed-tools: Bash Read Write Edit Glob Grep
metadata:
  tags: image compression pngquant oxipng tinypng jpegtran svgo 图片压缩 无损 量化 imgmin
  category: frontend
  author: zbw-zbw
---

# 图片压缩最佳实践（img-optimize）

按「质量档位 → 格式 → 通道」三步分流到成熟工具，压缩后必走验证闭环。源自 2026-09 视频签到活动 39 张 PNG 实战（5212K → 1501K，累计 -71%）。

## 执行原则（先读）

1. **质量档位判定先行**：动手前先问清（或从语境判断）「零损失」还是「肉眼无损可接受」——两者通道完全不同，搞反就是事故
2. **主体是现成工具**：优先 pngquant/oxipng/jpegtran/svgo 等成熟开源工具；本 skill 自带脚本只在受限环境（断网装不了工具）兜底
3. **有损必须告知**：任何会改像素的通道（量化/质量重编码/TinyPNG），执行前向用户显式说清并获确认
4. **不叠加重复压缩**：同一素材同一通道只跑一遍；流水线方向单向（无损 → 量化 → 可选无损收尾）
5. **压缩后必走验证闭环**：git 范围 → 像素校验（无损时）→ build → CDN 抽查，详见 [references/verification.md](references/verification.md)

## 决策树（30 秒定位通道）

```
质量要求？
├─ 零损失（像素逐字节不变）→ 仅无损层
│   PNG → oxipng；断网兜底 scripts/png-optimize.js
│   JPG → jpegtran -optimize
│   SVG → svgo
└─ 肉眼无损可接受（体积优先）→ 两阶段：无损打底 + 量化收尾
    素材可否上传第三方？
    ├─ 可以 → TinyPNG 通道（量化质量最稳，免费 500 次/月）
    └─ 不可以 → 本地 pngquant（带质量保护阀，同级效果）
```

工具全景矩阵、三平台安装命令、通道适用边界与收益数量级 → [references/decision-matrix.md](references/decision-matrix.md)

## 一键编排器（多格式批量场景）

PNG+JPG+SVG 混合批量压缩时不必逐格式拼命令，直接调 skill 自带编排器（项目零文件，任何目录可用）：

```bash
node ~/.agents/skills/img-optimize/scripts/imgmin.js [目录=src]   # macOS/Linux
# Windows: node %USERPROFILE%\.agents\skills\img-optimize\scripts\imgmin.js src
```

内置：工具探测与缺失降级、已量化检测（防重复量化）、WebP/AVIF 跳过、前后体积报告。团队想要 `npm run imgmin` 快捷方式时，package.json scripts 一行指向上述绝对路径即可（可选，非必需）。

## 格式分流

| 格式 | 主通道 | 详见 |
|---|---|---|
| PNG | 两阶段流水线：无损重编码 + 调色板量化；断网纯 Node 兜底 | [references/png-pipeline.md](references/png-pipeline.md) |
| JPG / WebP / SVG | jpegtran 无损 / cwebp 转换决策 / svgo | [references/jpg-webp-svg.md](references/jpg-webp-svg.md) |
| 跨格式云端通道 | TinyPNG（API 支持 PNG/JPG/WebP）：key/扩展/配额/数据安全 | [references/tinypng-channel.md](references/tinypng-channel.md) |

## 验证闭环（压缩的最后一公里）

**没有验证的压缩 = 未交付。** 完整步骤与避坑清单（eXIf Orientation 方向丢失、sips 假阳性、`.min` 后缀不生效、dry-run 耗配额等，全部实战核实过）→ [references/verification.md](references/verification.md)

## 完成标准

- [ ] 压缩报告成文（逐图前后体积 + OK/KEEP/SKIP 状态）
- [ ] `git diff` 范围仅图片（或与用户确认过的辅助文件）
- [ ] build 通过；无损通道额外像素校验通过
- [ ] 发布类任务：CDN 资源 hash 更新且抽查体积与本地一致
