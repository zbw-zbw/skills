#!/usr/bin/env python3
"""skill-ls — 汇总本机所有 Qoder/Aone 技能，按来源分类，生成总目录。

扫描来源：
  1. 个人通用 monorepo   ~/work/projects/skills/
  2. blog-workflow 独立仓  ~/work/blog-workflow/
  3. 业务技能源码仓       ~/work/projects/*/SKILL.md
  4. 团队共享项目技能     ~/work/projects/.agents/skills/
  5. Aone Copilot 安装   ~/.aone_copilot/skills/
  6. Qoder 用户级安装    ~/.qoder/skills/（真实目录=市场安装，软链=仓挂载）
  7. 插件技能           ~/.qoder/plugins/cache/<源>/<插件>/<版本>/skills/
  8. Aone 技能市场云端安装（发布名 zbw01218944-<name>，本地无落盘，源仓在 ~/work/projects/）

用法：
  python3 skill-ls.py            # 终端输出 + 写 ~/work/SKILLS.md
  python3 skill-ls.py --no-write # 仅终端输出
"""
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HOME = Path.home()
MONOREPO = HOME / "work/projects/skills"
BLOG_REPO = HOME / "work/blog-workflow"
PROJECTS_DIR = HOME / "work/projects"
TEAM_SKILLS = HOME / "work/projects/.agents/skills"
AONE_SKILLS = HOME / ".aone_copilot/skills"
QODER_SKILLS = HOME / ".qoder/skills"
PLUGIN_CACHE = HOME / ".qoder/plugins/cache"
CATALOG_FILE = HOME / "work/SKILLS.md"

# 本地维护的少量事实标注（无法从路径推导的部分）
AONE_PUBLISHED = {  # 已发布到 Aone 技能市场的技能（发布名 zbw01218944-<name>）
    "pixel-restore-next", "ai-coding-metrics", "h5-activity-workflow",
    "broccoli-publish", "skill-publish-sync", "daily-retrospect",
}
AONE_MARKET_ONLY = {  # 仅通过 Aone 市场云端安装（本地 ~/.qoder/skills 无落盘）
    "pixel-restore-next", "ai-coding-metrics", "h5-activity-workflow", "skill-publish-sync",
}


def read_frontmatter(skill_md: Path) -> dict:
    """解析 SKILL.md 的 YAML frontmatter（仅取 name/version/description 单行值）。"""
    meta = {"name": "", "version": "", "description": ""}
    try:
        text = skill_md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return meta
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return meta
    current = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line[:1] not in (" ", "\t") and ":" in line:
            key, _, value = line.partition(":")
            current = key.strip()
            value = value.strip().strip('"').strip("'")
            if value in (">", ">-", "|", "|-"):  # YAML 折叠/字面标量指示符
                value = ""
            if current in meta and not meta[current]:
                meta[current] = value
        elif current == "description" and line.startswith("  ") and len(meta["description"]) < 200:
            meta["description"] += " " + line.strip()
    return meta


def short_desc(desc: str, limit: int = 46) -> str:
    d = " ".join(desc.split())
    return (d[: limit - 1] + "…") if len(d) > limit else d


def git_info(repo: Path) -> str:
    """返回 git 状态摘要：远程存在性 + 未推送/未提交标记。"""
    def git(*args):
        try:
            return subprocess.run(
                ["git", "-C", str(repo), *args],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
        except Exception:
            return ""
    if not (repo / ".git").exists():
        return ""
    flags = []
    if not git("remote"):
        flags.append("无远程")
    else:
        local = git("rev-parse", "@")
        remote = git("rev-parse", "@{u}") if git("rev-parse", "--abbrev-ref", "@{u}") else ""
        if local and remote and local != remote:
            flags.append("未推送")
    status = git("status", "--porcelain")
    if status:
        flags.append("未提交")
    return ",".join(flags)


def qoder_mounts() -> dict:
    """~/.qoder/skills 挂载表：源路径(解析后) -> 挂载名。"""
    mounts = {}
    if not QODER_SKILLS.is_dir():
        return mounts
    for entry in QODER_SKILLS.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_symlink():
            target = entry.resolve()
            mounts[str(target)] = entry.name
    return mounts


def scan_dir_skills(base: Path) -> list:
    """扫描目录下每个子目录的 SKILL.md，返回条目列表。"""
    result = []
    if not base.is_dir():
        return result
    for d in sorted(base.iterdir()):
        if d.name.startswith(".") or not d.is_dir():
            continue
        skill_md = d / "SKILL.md"
        if not skill_md.exists():
            continue
        meta = read_frontmatter(skill_md)
        result.append({
            "name": meta["name"] or d.name,
            "version": meta["version"],
            "desc": short_desc(meta["description"]),
            "path": d,
            "flags": [],
        })
    return result


def collect():
    mounts = qoder_mounts()
    def mount_of(path: Path) -> str:
        return mounts.get(str(path.resolve()), "")

    data = {}

    # 1. 个人通用 monorepo
    entries = []
    if MONOREPO.is_dir():
        for skill_md in sorted(MONOREPO.glob("*/SKILL.md")):
            meta = read_frontmatter(skill_md)
            m = mount_of(skill_md.parent)
            entries.append({
                "name": meta["name"] or skill_md.parent.name, "version": meta["version"],
                "desc": short_desc(meta["description"]), "path": skill_md.parent,
                "flags": [f"挂载:{m}" if m else "未挂载!"],
            })
    git_flag = git_info(MONOREPO)
    data["monorepo"] = {"title": f"个人通用技能 · monorepo（{MONOREPO}）", "entries": entries, "extra": git_flag}

    # 2. blog-workflow 独立仓
    entries = []
    blog_md = BLOG_REPO / "SKILL.md"
    if blog_md.exists():
        meta = read_frontmatter(blog_md)
        entries.append({
            "name": meta["name"] or "blog-workflow", "version": meta["version"],
            "desc": short_desc(meta["description"]), "path": BLOG_REPO,
            "flags": [git_info(BLOG_REPO) or "同步", "private 铁律"],
        })
    data["blog"] = {"title": f"个人通用技能 · 独立仓（{BLOG_REPO}）", "entries": entries, "extra": ""}

    # 3. 业务技能源码仓
    entries = []
    if PROJECTS_DIR.is_dir():
        for d in sorted(PROJECTS_DIR.iterdir()):
            if not d.is_dir() or d.name.startswith(".") or d.name == "skills":
                continue
            skill_md = d / "SKILL.md"
            if not skill_md.exists():
                continue
            meta = read_frontmatter(skill_md)
            base_name = meta["name"] or d.name
            flags = []
            if base_name in AONE_PUBLISHED:
                flags.append("已发布Aone市场(zbw01218944-)")
                if base_name in AONE_MARKET_ONLY:
                    flags.append("仅云端安装")
            m = mount_of(d)
            flags.append(f"挂载:{m}" if m else "未挂载")
            g = git_info(d)
            if g:
                flags.append(g)
            entries.append({
                "name": meta["name"] or d.name, "version": meta["version"],
                "desc": short_desc(meta["description"]), "path": d, "flags": flags,
            })
    data["business"] = {"title": f"业务专用技能 · 源码仓（{PROJECTS_DIR}/）", "entries": entries, "extra": ""}

    # 4. 团队共享项目技能
    entries = scan_dir_skills(TEAM_SKILLS)
    data["team"] = {"title": f"团队共享技能 · 项目级（{TEAM_SKILLS}）", "entries": entries, "extra": "随 ~/work/projects 子项目生效，非全局"}

    # 5. Aone Copilot 安装
    entries = scan_dir_skills(AONE_SKILLS)
    data["aone"] = {"title": f"Aone Copilot 安装（{AONE_SKILLS}）", "entries": entries, "extra": ""}

    # 6. Qoder 用户级安装
    entries = []
    if QODER_SKILLS.is_dir():
        for d in sorted(QODER_SKILLS.iterdir()):
            if d.name.startswith(".") or not d.is_dir():
                continue
            skill_md = d / "SKILL.md"
            meta = read_frontmatter(skill_md) if skill_md.exists() else {}
            if d.is_symlink():
                kind = f"软链→{d.resolve()}"
            else:
                kind = "市场安装"
            entries.append({
                "name": meta.get("name") or d.name, "version": meta.get("version", ""),
                "desc": short_desc(meta.get("description", "")), "path": d, "flags": [kind],
            })
    data["qoder"] = {"title": f"Qoder 用户级安装（{QODER_SKILLS}）", "entries": entries, "extra": ""}

    # 7. 插件技能
    packs = []
    total = 0
    if PLUGIN_CACHE.is_dir():
        for source_dir in sorted(PLUGIN_CACHE.iterdir()):
            if not source_dir.is_dir():
                continue
            for plugin_dir in sorted(source_dir.iterdir()):
                if not plugin_dir.is_dir():
                    continue
                versions = sorted(v for v in plugin_dir.iterdir() if v.is_dir()) or [plugin_dir]
                latest = versions[-1]
                skills = [s for s in (latest / "skills").glob("*/SKILL.md")] if (latest / "skills").is_dir() else []
                if skills:
                    packs.append({"plugin": f"{plugin_dir.name}@{source_dir.name}", "count": len(skills), "version": latest.name})
                    total += len(skills)
    data["plugins"] = {"title": "插件技能（~/.qoder/plugins/cache/）", "packs": packs, "total": total, "entries": []}
    return data


def consistency_checks(data: dict) -> list:
    """挂载一致性检查。"""
    issues = []
    for entry in data["monorepo"]["entries"]:
        if any("未挂载" in f for f in entry["flags"]):
            issues.append(f"[monorepo] {entry['name']} 未挂载到 ~/.qoder/skills：ln -s {entry['path']} ~/.qoder/skills/{entry['name']}")
    for entry in data["qoder"]["entries"]:
        flags = " ".join(entry["flags"])
        if "软链" in flags and not entry["path"].resolve().exists():
            issues.append(f"[断链] ~/.qoder/skills/{entry['name']} 软链目标不存在")
        if not (entry["path"] / "SKILL.md").exists():
            issues.append(f"[缺文件] ~/.qoder/skills/{entry['name']} 无 SKILL.md")
    for entry in data["aone"]["entries"]:
        if not (entry["path"] / "SKILL.md").is_file():
            issues.append(f"[断链] Aone 安装 {entry['name']} 的 SKILL.md 不可读（软链失效）")
    return issues


def print_report(data: dict, issues: list):
    def row(name, ver, desc, flags):
        print(f"  {name:<28} {ver:<8} {desc:<48} {' '.join(flags)}")

    for key in ("monorepo", "blog", "business", "team", "aone", "qoder"):
        sec = data[key]
        if not sec["entries"]:
            continue
        print(f"\n== {sec['title']}  [{len(sec['entries'])}]")
        if sec.get("extra"):
            print(f"   git: {sec['extra']}")
        for e in sec["entries"]:
            row(e["name"], e["version"], e["desc"], e["flags"])

    p = data["plugins"]
    print(f"\n== {p['title']}  [插件包 {len(p['packs'])} 个 / 技能 {p['total']} 个]")
    for pack in p["packs"]:
        print(f"  {pack['plugin']:<48} v{pack['version']:<10} {pack['count']} skills")

    print(f"\n== 一致性检查  [{'全部通过' if not issues else f'{len(issues)} 个问题'}]")
    for i in issues:
        print(f"  {i}")


def write_catalog(data: dict, issues: list):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        "# SKILLS — 本机技能总目录",
        "",
        f"> 由 `skill-ls.py` 自动生成于 {now}；重新生成：`python3 ~/work/projects/skills/tools/skill-ls.py`",
        "",
        "| 分类 | 数量 |",
        "|---|---|",
    ]
    total = 0
    for key, label in (
        ("monorepo", "个人通用 · monorepo"), ("blog", "个人通用 · 独立仓"),
        ("business", "业务专用 · 源码仓"), ("team", "团队共享 · 项目级"),
        ("aone", "Aone Copilot 安装"), ("qoder", "Qoder 用户级安装"),
    ):
        n = len(data[key]["entries"])
        total += n
        lines.append(f"| {label} | {n} |")
    lines += [
        f"| 插件技能（{len(data['plugins']['packs'])} 个插件包） | {data['plugins']['total']} |",
        f"| **合计（不含插件）** | **{total}** |",
        "",
    ]

    for key in ("monorepo", "blog", "business", "team", "aone", "qoder"):
        sec = data[key]
        if not sec["entries"]:
            continue
        lines += [f"## {sec['title']}", ""]
        if sec.get("extra"):
            lines += [f"> git: {sec['extra']}", ""]
        lines += ["| 技能 | 版本 | 说明 | 备注 |", "|---|---|---|---|"]
        for e in sec["entries"]:
            lines.append(f"| {e['name']} | {e['version']} | {short_desc(e['desc'], 60)} | {'; '.join(e['flags'])} |")
        lines.append("")

    p = data["plugins"]
    lines += [f"## {p['title']}", "", "| 插件 | 版本 | 技能数 |", "|---|---|---|"]
    for pack in p["packs"]:
        lines.append(f"| {pack['plugin']} | {pack['version']} | {pack['count']} |")
    lines.append("")

    lines += ["## 一致性检查", ""]
    if not issues:
        lines.append("全部通过。")
    else:
        lines += [f"- {i}" for i in issues]
    lines.append("")

    CATALOG_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n目录已写入 {CATALOG_FILE}")


def main():
    write = "--no-write" not in sys.argv
    data = collect()
    issues = consistency_checks(data)
    print_report(data, issues)
    if write:
        write_catalog(data, issues)


if __name__ == "__main__":
    main()
