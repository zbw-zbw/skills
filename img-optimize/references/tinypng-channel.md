# TinyPNG（Tinify）通道

TinyPNG API 支持 PNG/JPG/WebP；SmartSelect 量化质量公认最稳。两条硬约束见文末。

## key 与配额

- 获取：https://tinypng.com/developers 邮箱注册 → Dashboard 复制 key，免费 **500 次/月**
- **上传即计数**（dry-run 也耗配额）；响应头 `Compression-Count` 返回当月用量
- API 本体是纯 REST，无需装 tinify-nodejs SDK：`POST https://api.tinify.com/shrink`（Basic auth，用户名 `api`、密码 key）→ `201` + `output.url`；`GET` 该 url 下载结果

## 通道一：IDE 扩展（andi1984.tinypng）

- key 存 secretStorage（命令面板 `TinyPNG: Set API Key`；settings.json 的 `tinypng.apiKey` 已废弃）
- **默认不覆盖原文件**，生成 `xxx.min.png`——项目按原文件名引用时压缩结果根本不会被使用，还残留垃圾文件。**必开**：

```jsonc
{ "tinypng.forceOverwrite": true }
```

- 配好后右键文件/目录 → `TinyPNG: Compress` / `Compress images in here`

## 通道二：本 skill 批量脚本（零依赖，报告更严谨）

```bash
echo 你的key > .tmp/tinify.key            # 或 export TINIFY_KEY=你的key
node scripts/tinify-compress.js           # dry-run：差异报告（不写盘，但耗配额）
node scripts/tinify-compress.js --apply   # 写盘（自动备份到 .tmp/tinify-backup/）
node scripts/tinify-compress.js --top 10  # 只压最大的 10 张，省配额
node scripts/tinify-compress.js --restore # 一键回滚
```

比扩展多的能力：

- **像素差异量化报告**：逐图输出「最大色差 / 变化像素占比 / >8 色差占比」——客观评估有损程度，渐变背景易出色带的图可单张放弃替换
- skip-if-larger（结果不小于原图自动保留原文件）
- <2KB 小图自动跳过（省配额）
- 写盘前自动备份 + 一键回滚

## 两条硬约束

1. **有损告知**：TinyPNG 对 PNG 是调色板量化、对 JPG 是有损重编码，像素会变。执行前向用户确认「肉眼无损可接受」；零损失诉求走本地无损层，不走本通道
2. **数据安全**：素材上传境外第三方服务器压缩。未发布的公司素材，执行前确认团队数据安全规范允许；不允许 → 本地 pngquant 同级替代
