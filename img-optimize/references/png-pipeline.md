# PNG 压缩流水线（两阶段）

## 阶段一：无损重编码（零损失打底）

成熟工具优先：

```bash
brew install oxipng
oxipng -o max --strip safe src/**/*.png
# -o max：最高优化级（多策略穷举）
# --strip safe：只剔非渲染元数据；默认结果更大时不写入（天然 skip-if-larger）
```

**断网/受限环境兜底**（本 skill 自带，optipng 同原理的纯 Node 实现，零依赖，Node ≥16）：

```bash
node scripts/png-optimize.js           # dry-run 出报告
node scripts/png-optimize.js --apply   # 写盘
node scripts/png-optimize.js 文件或目录  # 指定目标
```

特性：5 种行滤波器逐行择优（libpng 启发式）× zlib level9/memLevel9 × DEFAULT/RLE 策略穷举取最小产物；保留全部渲染相关 chunk（PLTE/tRNS/sRGB/iCCP/bKGD/pHYs/**eXIf**）；**每张写盘前对候选文件完整解码并与原像素逐字节比对，不一致拒绝替换**——零损失的数学保证。

> eXIf 永不剔除（哪怕只有 68 字节）：EXIF 可能含 Orientation 方向标记，浏览器默认 `image-orientation: from-image`，剔错方向显示就变了。详见 [verification.md](verification.md) 避坑清单。

## 阶段二：调色板量化（肉眼无损收尾）

```bash
brew install pngquant
pngquant --quality=80-95 --skip-if-larger --force --ext .png src/**/*.png
```

| 参数 | 语义 |
|---|---|
| `--quality=80-95` | 质量保护阀：可达 80 分以上才压，达不到自动跳过该图（文件保持原样） |
| `--skip-if-larger` | 结果更大时保留原文件 |
| `--force --ext .png` | 原地覆盖同名输出 |

批量退出码语义：`98`=有图因 skip-if-larger 跳过，`99`=有图质量不达标——**非 0 不代表整体失败**，看逐图输出判断。

**已量化检测（防重复量化）**：执行前读 IHDR 第 25 字节判 colorType，`3`（索引色）= 已量化图，跳过 pngquant 直接进无损收尾——重复量化有累积质量损失风险（双重保护阀也拦不住色数缓降）。判定一行即可：`xxd -s 25 -l 1 -p file.png` → `03`。TinyPNG 处理过的素材再补压缩时必过此检。

执行前必须向用户确认「肉眼无损可接受」（量化会改像素）。素材敏感/不想耗配额时，pngquant 就是 TinyPNG 的本地同级替代。

**接力非叠加**：阶段一收益已即时落袋；阶段二之后可再跑一发 `oxipng` 收尾（量化产物通常已接近极限，KEEP 居多）。同一素材同一通道不要跑两遍。

## IDE 扩展通道（TinyPNG 官方 API）

Qoder/VS Code 装 `andi1984.tinypng` → 命令面板 `TinyPNG: Set API Key` → 右键目录 Compress。**必开 `"tinypng.forceOverwrite": true`**，否则生成 `.min.png` 后缀新文件而代码引用原文件名，压了不生效。完整避坑 → [tinypng-channel.md](tinypng-channel.md)
