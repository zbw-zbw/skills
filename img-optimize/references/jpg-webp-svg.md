# JPG / WebP / SVG 通道

> 置信度声明：PNG 流水线经 39 张实战闭环验证；本节为工具链标准用法，未在同等深度实战验证——**首次使用先小批量试跑，确认效果后再全量**。

## JPG

**无损**（像素不变：huffman 表优化 + 渐进式 + 剥元数据）：

```bash
# jpegtran 随 libjpeg/mozjpeg 安装（brew install jpeg-turbo / mozjpeg）
for f in src/**/*.jpg; do
  jpegtran -optimize -copy none -progressive -outfile "$f.tmp" "$f" && mv "$f.tmp" "$f"
done
```

- `-optimize`：优化 huffman 表；`-progressive`：渐进式加载（多数场景体验更优）
- `-copy none`：剥除 EXIF/注释——**若图含 Orientation 方向标记，剥除后浏览器显示方向会变**；带方向的手机照片先确认再剥（用 `-copy all` 保留）
- jpegtran 总会写出产物，需自己比对体积决定是否替换（脚本里做 skip-if-larger）

**有损重编码**（体积优先时）：`cjpeg -quality 82`（mozjpeg 同名工具，等质量比 libjpeg 小 5-10%）。JPG 每代重编码都有代际损失——尽量从原始素材一次压到位，不反复压已压缩的 JPG。

## WebP

已是高效格式，存量 WebP **默认不自动重压**（有损源重编码有代际损失，重编码前先小样验证质量）。两个使用场景：

- **新素材转 WebP**：`cwebp -q 85 in.png -o out.webp`——同质量比 PNG 两阶段流水线再省 25%+；但这是格式迁移决策（要改代码引用/构建管线），不属于「原样压缩」范畴。运行环境确认：现代 WebView 内核均支持
- **无损模式**：`cwebp -lossless`——扁平 UI 图可能比 PNG 更小，照片通常反而更大，实测为准

## SVG

```bash
brew install svgo
svgo --multipass icon.svg           # 单文件原地优化
svgo --multipass -f src/assets      # 整目录
```

- svgo 默认配置即安全（结构/精度优化，视觉无损）；`--multipass` 多轮优化直到收敛
- 内嵌 base64 位图的 SVG 不适用（那部分是位图压缩范畴，解出来按 PNG/JPG 处理）
- React 组件化的 SVG（如 svgIcon 组件内联 path）：优化对象是源码里的 path 数据，按 svgo 语义人工评估，不直接跑文件命令
