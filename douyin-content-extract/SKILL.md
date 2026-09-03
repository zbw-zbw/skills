---
name: douyin-content-extract
version: 1.1.0
description: 提取抖音（douyin.com）视频/图文帖的完整文案——图文帖抓原图逐张视觉识别（零 OCR 误差），真实视频抽关键帧识别画面文字，顺带抓帖子描述文字。当用户给出 douyin.com 链接（含带 modal_id 的主页链接、v.douyin.com 短链）并要求提取文案/文字/内容/字幕/图片文字/OCR 时使用。
---

# 抖音内容提取

自包含通用 skill：方法论 + 两个内置脚本（本 skill `scripts/` 目录，零第三方依赖，仅用 curl 与系统自带的 sips/ffmpeg）。视觉识别环节由 agent 自己逐张读图完成，不装 OCR 引擎——图文帖原图是 1080p 干净版本，识别零误差且能保留标题层级、列表、高亮等排版。

## 核心结论（实测踩坑，勿重蹈）

- yt-dlp 对抖音不可用：extractor 报 `Fresh cookies (not necessarily logged in) are needed`，加 `--cookies-from-browser chrome` 同样无效。不要在这条路上浪费时间。
- 图文帖（知识类账号最常见形态）的 video 元素 `videoWidth=0`，`currentSrc` 实为纯音频流（m4a），下载「视频」无意义。
- 正确路径：浏览器开 `/video/{id}` 页 → JS 提取原图 URL → curl 下载 → 转 png → Read 视觉识别。

## 总流程

```
- [ ] 1. URL 归一化出视频 ID
- [ ] 2. 浏览器开/复用视频页（临时标签，用完即关，事先向用户说明）
- [ ] 3. 抓帖子描述文字
- [ ] 4. 判定形态：图文帖 / 真实视频
- [ ] 5. 图文：extract_slides.js 取 URL 清单 → fetch_slides.sh 下载转 png
- [ ] 5'. 真实视频：取 video src 下载 → ffmpeg 抽帧去重
- [ ] 6. Read 逐张识别（每批 4 张）
- [ ] 7. 汇编 markdown 交付 + 关临时标签
```

### 1. URL 归一化

- `douyin.com/video/<id>` → id 即视频 ID。
- 用户主页带 `?modal_id=<id>` → modal_id 就是视频 ID（把主页 URL 直接喂任何工具都会失败）。
- `v.douyin.com/<short>` 短链 → `curl -sI <short>` 跟随重定向取最终 URL 里的 id。

### 2. 进入视频页

先 `tabs_context` 看是否已有同 id 的 douyin 标签可复用；没有则新开标签 navigate 到 `https://www.douyin.com/video/<id>`。

### 3. 帖子描述文字（javascript_tool）

```js
document.querySelector('[data-e2e="video-desc"]')?.innerText || ''
```

selector 随版本可能失效；fallback：从 `script#RENDER_DATA`（内容需 `decodeURIComponent`）里找 desc 字段，或直接 `get_page_text` 人工摘。

### 4. 形态判定（javascript_tool）

```js
JSON.stringify({
  slides: document.querySelectorAll('img[src*="aweme_images"]').length,
  videoWidth: document.querySelector('video')?.videoWidth || 0
})
```

`slides > 0` → 图文帖走 5；否则 `videoWidth > 0` → 真实视频走 5'。

### 5. 图文帖原图提取

用 browser javascript_tool 执行本 skill 的 `scripts/extract_slides.js`（按 src 去重、过滤 naturalWidth<720 的小图），返回 JSON 数组；写成一行一个 URL 的清单文件。

若张数明显少于页面页码指示器（轮播懒加载）：聚焦播放器按几次 ArrowRight（或点下一页箭头）翻完再重新提取合并去重。

下载 + 转 png：

```bash
bash "$SKILL/scripts/fetch_slides.sh" <url清单文件> <输出目录>
```

（`$SKILL` = 本 skill 所在目录，运行时解析。）脚本并行 curl（带 Referer）并把 webp 转 png（sips 优先、ffmpeg 兜底）。

### 5'. 真实视频关键帧

JS 取 `document.querySelector('video').currentSrc`，curl 下载（带 Referer），然后：

```bash
ffmpeg -v error -i v.mp4 -vf "fps=1/2,scale=-2:1080" frame_%03d.png
```

帧率按字幕/画面切换密度调（口播烧字字幕通常 1~2s 一换）。相邻重复帧先去重（比文件大小/md5，再目检）再识别。需要语音转文字时交给 video-processor 技能，本 skill 不内置 whisper。

口播烧字字幕的视频，转录主字幕比逐帧读全图高效得多：裁字幕带叠成竖条批量 Read。

```bash
# 字幕带（1080p 坐标：y=880 起高 200，覆盖底部字幕行）
ffmpeg -v error -y -i v.mp4 -vf "fps=1/2,scale=-2:1080,crop=1920:200:0:880" subs/s_%03d.png
# 每 10 行叠一条竖条再 Read（输入不足 10 帧时 tile 自动补黑行，属正常）
ffmpeg -v error -y -start_number 1 -i subs/s_%03d.png -frames:v 10 -vf "tile=1x10" -update 1 strip_1.png
```

**crop 坐标按滤镜链当前分辨率计**：必须先 `scale=-2:1080` 再 `crop`，源是 4K 时直接用 1080p 坐标裁会裁到画面中段（人像/桌面）而不是字幕。

**2s 采样会漏 <2s 的短字幕行**：读完竖条后通读转录稿，凡前后两句语义接不上的接缝（如后句以「到…」开头），用 `-ss <t-1> -t <窗口> -vf "fps=2,...,tile=1xN"` 对该接缝 ±3s 补采一条竖条 Read 补齐；补采窗口只开语义断裂处，不必全片 fps=2。

### 6. 视觉识别

Read png 每批 4 张，逐字转录：保留标题层级、列表编号、【占位符】高亮、斜体句；不概括、不改写、不补脑。

### 7. 交付

markdown 结构：来源链接 + 作者账号 + 帖子描述文字 + 逐页/逐帧文案（标题用卡片主标题）。
保存位置随调用环境：QoderWork 会话 → 会话 outputs 目录并 present_files；纯 CLI 环境 → `~/Documents/douyin-extract/<video-id>.md`。
收尾关掉第 2 步自开的临时标签（用户自己开的标签不动）。

## Pitfalls

- `[data-e2e="video-desc"]` 在部分 /video/ 页返回空串；fallback 用 JS 扫叶子节点匹配关键词（如 #、prompt），或直接 get_page_text 人工摘。
- 字幕带裁剪图不要用 md5 去重：背景逐帧变化永远不折叠；转录竖条时目视合并连续重复句即可。
- 图片 URL 带 `x-expires`/`x-signature` 签名，提取后立即下载；URL 清单跨天复用必 403。
- 同一张图在 DOM 里出现两次（动画双层），必须按 src 去重，否则交付一半是重复页。
- CDN 请求必须带 `Referer: https://www.douyin.com/`，否则 403 或空体。
- Read 工具对 webp 支持不稳，一律先转 png 再识别。
- 提取统一走 `/video/<id>` 形态；modal_id 主页的 DOM 结构不同。
- 浏览器连接器不在线时：不要退回去试 yt-dlp（必败），直接告知用户需启用浏览器连接器或人工提供图片包。
- 真实视频若为 DASH 分流（video/audio 分离），currentSrc 可能是 blob:——此时改从 network requests 里找 `.mp4`/douyinvod 请求 URL。

## Verification

- 下载 png 数 == 去重 URL 数，且每个文件 >10KB（`ls -l` 核对）。
- 抽读首、末两张图：内容主题与帖子描述相符、无缺页（与页码指示器数量对照）。
- 交付稿字数与图内文字量相称：某页识别结果仅一两行而原图满版文字 = 漏识，重 Read 该页。
