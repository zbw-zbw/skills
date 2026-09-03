# skills

个人通用技能资产库。脱离内部业务环境可用的 skill 收录于此，跨机 clone 即可恢复。

## 技能清单

| 技能 | 用途 |
|---|---|
| [douyin-content-extract](./douyin-content-extract/) | 提取抖音视频/图文帖的完整文案（原图视觉识别，零 OCR 误差） |
| [thinking-toolkit](./thinking-toolkit/) | 10 个结构化思维框架，按问题自动路由执行 |
| [talent-discovery](./talent-discovery/) | 深度天赋挖掘——苏格拉底式追问拼出个人天赋使用说明书 |
| [life-design](./life-design/) | 斯坦福人生设计方法，生成三个五年人生版本与原型行动清单 |
| [blog-workflow](https://github.com/zbw-zbw/blog-workflow) | 技术博客多平台自动发布流水线（独立仓库，含运行数据，**必须保持 private**） |

## 跨机恢复

```bash
git clone git@github.com:zbw-zbw/skills.git ~/work/projects/skills

for s in douyin-content-extract thinking-toolkit talent-discovery life-design; do
  ln -s ~/work/projects/skills/$s ~/.qoder/skills/$s
done
```

## 管理工具

`tools/skill-ls.py` 汇总本机全部 8 类技能来源（本仓、blog-workflow、业务源码仓、团队共享、Aone Copilot、Qoder 用户级、插件、Aone 云端安装），分类输出终端报告并生成总目录 `~/work/SKILLS.md`，同时校验软链挂载与 SKILL.md 完整性：

```bash
python3 ~/work/projects/skills/tools/skill-ls.py            # 终端输出 + 写 ~/work/SKILLS.md
python3 ~/work/projects/skills/tools/skill-ls.py --no-write # 仅终端输出
```

## 收录原则

- 只收通用个人技能；业务专用技能（依赖 Aone/O2/Broccoli 等内部平台）不入库
- 他人开源技能（如 humanizer-zh）不入库，从市场重装即得
- 新技能迁入时先扫敏感信息（token / 内部 URL / 凭证）
