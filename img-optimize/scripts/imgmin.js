#!/usr/bin/env node
'use strict';
/**
 * 一键图片压缩编排器（img-optimize skill 自带，项目零文件直调）
 *
 * 用法（任何项目目录下，无需向项目写任何文件）：
 *   node <skill目录>/scripts/imgmin.js [目标目录=src]
 *   例：node ~/.agents/skills/img-optimize/scripts/imgmin.js src
 *       （Windows：%USERPROFILE%\.agents\skills\img-optimize\scripts\imgmin.js）
 * 团队想要 npm run 快捷方式时，在 package.json scripts 加一行指向上述绝对路径即可（可选）。
 *
 * 按格式分发到本地成熟工具（缺哪个提示装哪个，对应格式自动跳过）：
 *   PNG  → pngquant --quality=80-95（有损量化，肉眼无损档，质量保护阀；已量化图自动跳过）
 *          → oxipng -o max（无损收尾，skip-if-larger）
 *   JPG  → jpegtran -optimize -progressive（纯无损，huffman 优化）
 *   SVG  → svgo --multipass（无损结构优化）
 *   WebP → 跳过（已是高效格式，重编码有代际损失，不自动处理）
 *
 * 跨平台：macOS / Linux / Windows。Windows 下 spawn 走 shell（npm 装的 CLI 是 .cmd shim，
 * 无 shell 找不到），文件参数自动加引号，批量分组减半以避开 cmd 8191 字符行长限制。
 *
 * 安全语义：所有通道结果更大时保留原文件；pngquant 达不到质量下限的图自动跳过；
 *           已量化（palette/索引色）PNG 自动跳过 pngquant，防止重复量化累积质量损失。
 *
 * 有损说明：pngquant 量化会改像素（肉眼无损档）。如需像素级零损失，
 * 只跑无损层：oxipng -o max --strip safe <目录>
 */
/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
// Windows shell 模式下路径含空格会被拆分，统一引号包裹；固定参数无需处理
const q = (f) => (IS_WIN ? `"${f}"` : f);
// cmd.exe 单条命令行上限 8191 字符，Windows 分组减半；macOS/Linux 无此限制
const BATCH = IS_WIN ? 20 : 40;

const TARGET = process.argv[2] || 'src';
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.git', '.tmp', '.temp']);

const INSTALL_HINT = IS_WIN
  ? 'scoop install pngquant oxipng jpegtran && npm i -g svgo'
  : process.platform === 'darwin'
    ? 'brew install pngquant oxipng jpegtran svgo'
    : 'sudo apt install pngquant oxipng libjpeg-turbo-progs && npm i -g svgo';

function has(tool) {
  const r = spawnSync(tool, tool === 'jpegtran' ? ['-version'] : ['--version'], {
    encoding: 'utf8',
    shell: IS_WIN,
  });
  return r.status === 0 || (r.stdout && r.stdout.length > 0);
}

function collect(dir, exts) {
  const files = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (exts.some((e) => name.toLowerCase().endsWith(e))) files.push(p);
    }
  })(dir);
  return files;
}

const sizeOf = (f) => fs.statSync(f).size;
const fmt = (n) => `${(n / 1024).toFixed(1)}K`;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function pngColorType(f) {
  // IHDR 第 25 字节：0=灰度 2=truecolor 3=索引色（已量化） 4=灰度+A 6=truecolor+A
  const fd = fs.openSync(f, 'r');
  const buf = Buffer.alloc(1);
  fs.readSync(fd, buf, 0, 1, 25);
  fs.closeSync(fd);
  return buf[0];
}

function runPngquant(files) {
  // 批量原地量化；退出码 98=有图 skip-if-larger，99=有图质量不达标，均非整体失败
  for (const batch of chunk(files, BATCH)) {
    spawnSync(
      'pngquant',
      ['--quality=80-95', '--skip-if-larger', '--force', '--ext', '.png', ...batch.map(q)],
      { stdio: 'inherit', shell: IS_WIN },
    );
  }
}

function runOxipng(files) {
  for (const batch of chunk(files, BATCH)) {
    spawnSync('oxipng', ['-o', 'max', '--strip', 'safe', ...batch.map(q)], {
      stdio: 'inherit',
      shell: IS_WIN,
    });
  }
}

function runJpegtran(files) {
  let shrunk = 0;
  for (const f of files) {
    const tmp = `${f}.min`;
    const r = spawnSync(
      'jpegtran',
      ['-optimize', '-copy', 'none', '-progressive', '-outfile', q(tmp), q(f)],
      { shell: IS_WIN },
    );
    if (r.status !== 0 || !fs.existsSync(tmp)) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      console.log(`  SKIP ${f}（jpegtran 失败）`);
      continue;
    }
    if (sizeOf(tmp) < sizeOf(f)) {
      fs.renameSync(tmp, f);
      shrunk++;
    } else {
      fs.unlinkSync(tmp); // 结果不小于原图，保留原文件
    }
  }
  console.log(`  jpegtran：${files.length} 张处理，${shrunk} 张变小替换`);
}

function runSvgo(files) {
  for (const f of files) {
    spawnSync('svgo', ['--multipass', q(f)], { stdio: 'inherit', shell: IS_WIN });
  }
}

function main() {
  const targetDir = path.resolve(process.cwd(), TARGET);
  if (!fs.existsSync(targetDir)) {
    console.error(`目录不存在：${targetDir}`);
    process.exit(1);
  }

  const png = collect(targetDir, ['.png']);
  const jpg = collect(targetDir, ['.jpg', '.jpeg']);
  const svg = collect(targetDir, ['.svg']);
  const webp = collect(targetDir, ['.webp', '.avif']);
  console.log(
    `扫描 ${TARGET}/：PNG ${png.length} · JPG ${jpg.length} · SVG ${svg.length} · WebP/AVIF ${webp.length}\n`,
  );

  if (webp.length) console.log(`WebP/AVIF ${webp.length} 张默认跳过（已是高效格式，不自动重压）\n`);

  const tools = {
    pngquant: has('pngquant'),
    oxipng: has('oxipng'),
    jpegtran: has('jpegtran'),
    svgo: has('svgo'),
  };
  const missing = Object.entries(tools)
    .filter(([, ok]) => !ok)
    .map(([t]) => t);
  if (missing.length) {
    console.log(`⚠️  缺少工具：${missing.join(', ')} —— 对应格式被跳过`);
    console.log(`   安装：${INSTALL_HINT}\n`);
  }

  const before = {};
  const measure = (name, files) => {
    before[name] = files.reduce((s, f) => s + sizeOf(f), 0);
  };

  if (png.length) {
    measure('PNG', png);
    const toQuant = png.filter((f) => pngColorType(f) !== 3);
    const skipQuant = png.length - toQuant.length;
    if (skipQuant) {
      console.log(`已量化（palette PNG）${skipQuant} 张，跳过 pngquant 防重复量化，直接无损收尾`);
    }
    if (tools.pngquant && toQuant.length) {
      console.log(`[1/2] pngquant 量化 ${toQuant.length} 张（--quality=80-95 质量保护阀）...`);
      runPngquant(toQuant);
    }
    if (tools.oxipng) {
      console.log(`[2/2] oxipng 无损收尾 ${png.length} 张（-o max）...`);
      runOxipng(png);
    }
    if (!tools.pngquant && !tools.oxipng) console.log('PNG 未处理（缺工具）');
  }
  if (jpg.length && tools.jpegtran) {
    measure('JPG', jpg);
    console.log(`jpegtran 无损优化 ...`);
    runJpegtran(jpg);
  }
  if (svg.length && tools.svgo) {
    measure('SVG', svg);
    console.log(`svgo 优化 ...`);
    runSvgo(svg);
  }

  console.log('\n================ imgmin 报告 ================');
  let totalB = 0;
  let totalA = 0;
  const report = (name, files) => {
    if (!before[name] && before[name] !== 0) return;
    const after = files.reduce((s, f) => s + sizeOf(f), 0);
    totalB += before[name];
    totalA += after;
    const pct = before[name] ? ((1 - after / before[name]) * 100).toFixed(1) : '0.0';
    console.log(
      `${name.padEnd(4)} ${fmt(before[name]).padStart(9)} -> ${fmt(after).padStart(9)}  (-${pct}%)  ${files.length} 张`,
    );
  };
  if (png.length) report('PNG', png);
  if (jpg.length && tools.jpegtran) report('JPG', jpg);
  if (svg.length && tools.svgo) report('SVG', svg);
  if (totalB) {
    console.log('--------------------------------------------');
    console.log(`合计 ${fmt(totalB)} -> ${fmt(totalA)}（-${((1 - totalA / totalB) * 100).toFixed(1)}%）`);
    console.log('\n后续：git status 确认改动仅图片 → 项目构建命令验证');
  } else {
    console.log('（无可处理目标——缺工具或无图片）');
  }
}

main();
