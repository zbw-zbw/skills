# skills

个人通用技能资产库。脱离内部业务环境可用的 skill 收录于此，跨机 clone 即可恢复。

## 技能清单

| 技能 | 用途 |
|---|---|
| [code-discipline](./code-discipline/) | AI 写代码通用纪律：注释克制禁 emoji、改动最小化、跟随项目风格、不滥依赖不过度设计、不编造 API、通用产物不绑本机路径、交付前跑验证；内置自迭代协议（被纠正/踩坑时把经验沉淀进对应 skill）。每次编码任务必触发 |
| [douyin-content-extract](./douyin-content-extract/) | 提取抖音视频/图文帖的完整文案（原图视觉识别，零 OCR 误差） |
| [img-optimize](./img-optimize/) | 图片压缩最佳实践：质量档位×格式×环境三步分流到成熟工具（pngquant/oxipng/jpegtran/svgo/TinyPNG），含验证闭环与断网纯 Node 兜底脚本 |
| [thinking-toolkit](./thinking-toolkit/) | 10 个结构化思维框架，按问题自动路由执行 |
| [talent-discovery](./talent-discovery/) | 深度天赋挖掘——苏格拉底式追问拼出个人天赋使用说明书 |
| [life-design](./life-design/) | 斯坦福人生设计方法，生成三个五年人生版本与原型行动清单 |
| [blog-workflow](https://github.com/zbw-zbw/blog-workflow) | 技术博客多平台自动发布流水线（独立仓库，含运行数据，**必须保持 private**） |

## 跨机恢复

```bash
git clone git@github.com:zbw-zbw/skills.git ~/work/projects/skills   # clone 到任意目录皆可
SKILLS_ROOT=~/work/projects/skills                                    # 下述命令均以此变量引用

for s in code-discipline douyin-content-extract img-optimize thinking-toolkit talent-discovery life-design; do
  ln -s $SKILLS_ROOT/$s ~/.qoder/skills/$s
  ln -s $SKILLS_ROOT/$s ~/.agents/skills/$s
done
```

## 挂载管理（统一规则）

源码仓集中在 `~/work/projects/<skill-name>`（git 管理），双侧软链挂载：

| 挂载位 | 名称规则 | 说明 |
|---|---|---|
| `~/.qoder/skills/` | 原始名（frontmatter name） | Qoder 用户级 |
| `~/.agents/skills/` | 已发布 Aone 用渠道名 `<工号前缀>-<name>`；未发布用原始名 | a1/Aone 渠道语义，跨 agent 读取 |

- 通用 monorepo 内 6 个 skill 双侧挂载（均未发布 Aone，双侧原始名）
- 业务 skill 源码仓双挂：qoder 侧原始名 + agents 侧渠道名
- 市场安装的实体目录（非软链）不动，走独立升级机制
- 挂载状态动态检查：`python3 $SKILLS_ROOT/tools/skill-ls.py --no-write`（源码仓扫出「未挂载」即缺口）

业务 skill 补挂载（逐行读，zsh/bash 通用；源码目录名与挂载名不同时第二列映射，可重复执行）：

```bash
while read -r src name; do
  [ -z "$src" ] && continue
  ln -sfn ~/work/projects/$src ~/.qoder/skills/$name
  ln -sfn ~/work/projects/$src ~/.agents/skills/zbw01218944-$name
done <<'EOF'
ai-coding-metrics ai-coding-metrics
aone-bug-loop aone-bug-loop
broccoli-component-dev broccoli-component-dev
broccoli-publish-skill broccoli-publish
daily-retrospect daily-retrospect
delivery-gate delivery-gate
h5-activity-workflow h5-activity-workflow
intranet-sso-dev-proxy intranet-sso-dev-proxy
pixel-restore-next pixel-restore-next
skill-publish-sync skill-publish-sync
uc-track-verify uc-track-verify
EOF
```

## 管理工具

`tools/skill-ls.py` 汇总本机全部 8 类技能来源（本仓、blog-workflow、业务源码仓、团队共享、Aone Copilot、Qoder 用户级、插件、Aone 云端安装），分类输出终端报告并生成总目录 `~/work/SKILLS.md`，同时校验软链挂载与 SKILL.md 完整性。属本机管理工具（按本机 `~/work` 目录约定扫描），用法信息存全局记忆，不入通用 skill 正文：

```bash
python3 $SKILLS_ROOT/tools/skill-ls.py            # 终端输出 + 写 ~/work/SKILLS.md
python3 $SKILLS_ROOT/tools/skill-ls.py --no-write # 仅终端输出
```

## 收录原则

- 只收通用个人技能；业务专用技能（依赖 Aone/O2/Broccoli 等内部平台）不入库
- 他人开源技能（如 humanizer-zh）不入库，从市场重装即得
- 新技能迁入时先扫敏感信息（token / 内部 URL / 凭证）
