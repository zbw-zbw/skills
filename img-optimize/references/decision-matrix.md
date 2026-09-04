# 工具全景与通道决策矩阵

> 工具行为与价格为 2026-09 快照，以工具实际返回为准，不符时如实上报。

## 两层原理（压缩到底在压什么）

图片文件 = 像素数据 + 编码容器，压缩分两层：

1. **无损层（重打包）**：PNG 行滤波器重新择优 + zlib/DEFLATE 最强参数；JPG 的 huffman 表优化。像素一个字节不变，只是装得更紧——设计工具（MasterGo/Sketch/Figma）导出时常没榨干这层
2. **有损层（减色/重编码）**：PNG 真彩 24/32bit → ≤256 色调色板 + 抖动；JPG/WebP 按质量参数重编码。像素会变，UI 类素材通常肉眼难辨；体积收益大头在这层（实测 -40%~-55%）

**业界标准 PNG 流水线 = 无损打底 + 量化收尾**（等价 optipng/zopfli + pngquant/TinyPNG 组合）。两层是**接力非叠加**：量化会重写编码层，无损层先跑的收益已即时落袋，量化后旧编码不保留。

## 工具全景矩阵（全免费）

| 层 | 工具 | 协议/额度 | 一句话 |
|---|---|---|---|
| PNG 无损 | **oxipng** | MIT | Rust 版 optipng，快且压得深，首选 |
| | optipng / zopflipng | 开源 | 经典方案；zopfli 压得更小但慢百倍 |
| PNG 量化 | **pngquant** | GPL | TinyPNG 的本地等价物，质量档位自控 |
| | **TinyPNG API** | 免费 500 次/月 | SmartSelect 量化质量公认最稳；素材上传境外服务器 |
| | TinyPNG 网页 | 免费免 key | 一次 20 张、单张 ≤5MB |
| JPG 无损 | **jpegtran** | BSD 类 | huffman 优化 + 渐进式 + 剥元数据 |
| JPG 重编码 | cjpeg / mozjpeg | 开源 | 质量参数重编码，有损 |
| WebP | **cwebp** | 开源 | 同质量比 PNG/JPG 再省 25%+ |
| SVG | **svgo** | MIT | 结构/精度无损优化 |
| 一体化 GUI | ImageOptim（Mac） | 开源 | 拖拽即用，内部自动编排全家桶 |
| | Squoosh（Google） | 免费 | 浏览器 WASM 本地压缩不上传，单张操作 |
| npm 生态 | imagemin 系列 | 已停止维护 | 不推荐新接入 |

## 三平台安装矩阵

| 工具 | macOS | Linux (Debian/Ubuntu) | Windows |
|---|---|---|---|
| pngquant | `brew install pngquant` | `sudo apt install pngquant` | `scoop install pngquant`（或官网 exe） |
| oxipng | `brew install oxipng` | `sudo apt install oxipng` | `scoop install oxipng`（或 GitHub Releases exe） |
| jpegtran | `brew install jpeg-turbo` | `sudo apt install libjpeg-turbo-progs` | `scoop install jpeg-turbo`（或 libjpeg-turbo 官网 exe） |
| svgo | `brew install svgo` | `npm i -g svgo` | `npm i -g svgo` |

> Windows 注意：npm 全局装的 CLI 是 `.cmd` shim，直接 `spawnSync` 找不到——本 skill 的 imgmin.js 已在 Windows 下自动切 shell 模式处理；自己拼命令时用 `npx svgo` 或在 cmd/PowerShell 中直接敲即可。工具行为与价格为 2026-09 快照，以实际为准。

## 通道选择（按顺序回答三个问题）

1. **质量要求？** 零损失 → 只走无损层；肉眼无损可接受 → 两阶段流水线
2. **素材能否上传第三方？** 未发布公司素材优先本地通道（pngquant）；已公开素材可享 TinyPNG 质量优势
3. **环境是否可装工具？** 可装 → 本地工具链（安装矩阵见上）；断网/受限沙箱 → 本 skill 纯 Node 脚本兑底（仅 PNG 无损层，crc32 已内置低版本 polyfill，Node ≥16 全可用）

## 收益数量级参考（2026-09 视频签到活动，39 张设计稿切图）

- 仅无损层：5212K → 4185K（-19.7%），最大单张 -47%；已充分压缩的 5 张自动 KEEP
- + TinyPNG 量化：4185K → 1501K（累计 -71%），单张最大 822K → 249K

单项目经验常数，仅供参考；照片类素材量化收益高于扁平 UI，以实际素材为准。
