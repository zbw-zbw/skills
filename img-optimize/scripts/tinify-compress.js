#!/usr/bin/env node
'use strict';
/**
 * Tinify (TinyPNG) 批量压缩 —— 零依赖纯 Node 客户端
 *
 * 与官方 tinify-nodejs SDK 等效（POST https://api.tinify.com/shrink + GET 下载结果），
 * 但不往项目 package.json 添加任何依赖，Node 16+ 可直接运行。
 *
 * 相比 IDE 扩展的增强：
 *   - skip-if-larger：TinyPNG 结果不小于原图时自动保留原文件
 *   - 像素差异量化：压缩前后逐像素比对（最大色差 / 变化像素占比），客观评估"有损"程度
 *   - --top N：只压最大的 N 张，节省免费配额（500 次/月）
 *   - 写盘前自动备份到 .tmp/tinify-backup/，--restore 一键回滚
 *   - 实时显示当月配额用量（Compression-Count）
 *
 * Key 获取：https://tinypng.com/developers 邮箱注册（免费 500 次/月）→ Dashboard 复制
 * Key 提供（二选一）：环境变量 TINIFY_KEY，或写入 .tmp/tinify.key 首行
 *
 * 用法（在本机终端跑；注意：上传即消耗配额，dry-run 也不例外）：
 *   node .tmp/tinify-compress.js                # 全部 dry-run（出差异报告，不写盘）
 *   node .tmp/tinify-compress.js --top 10       # 只压最大的 10 张
 *   node .tmp/tinify-compress.js --apply        # 实际写盘（写前自动备份）
 *   node .tmp/tinify-compress.js --restore      # 回滚到备份版本
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const KEY_FILE = path.join(__dirname, 'tinify.key');
const BACKUP_DIR = path.join(__dirname, 'tinify-backup');
const MIN_SIZE = 2048;      // 小于 2K 的图跳过（收益微小还耗配额）
const SAVE_THRESHOLD = 128; // 结果至少小 128 字节才替换

// ---------- key ----------
function getKey() {
  if (process.env.TINIFY_KEY) return process.env.TINIFY_KEY.trim();
  if (fs.existsSync(KEY_FILE)) {
    const first = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
    if (first) return first;
  }
  return null;
}

// ---------- HTTP ----------
function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request(
      { method, hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 60000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    r.on('timeout', () => r.destroy(new Error('请求超时（60s）')));
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function shrink(buf, key) {
  const auth = 'Basic ' + Buffer.from('api:' + key).toString('base64');
  const res = await req(
    'POST', 'https://api.tinify.com/shrink',
    { Authorization: auth, 'Content-Type': 'image/png' }, buf
  );
  if (res.status === 401) throw new Error('API key 无效（401），请检查 .tmp/tinify.key');
  if (res.status === 429) throw new Error('超出本月免费配额（429）');
  if (res.status !== 201) {
    throw new Error(`shrink 失败 ${res.status}: ${res.body.toString('utf8').slice(0, 200)}`);
  }
  const json = JSON.parse(res.body.toString('utf8'));
  return { url: json.output.url, count: res.headers['compression-count'] };
}

async function download(url) {
  const res = await req('GET', url, {}, null);
  if (res.status !== 200) throw new Error(`下载压缩结果失败 ${res.status}`);
  return res.body;
}

// ---------- PNG 解码（仅用于像素差异统计；不做 CRC 校验以兼容 Node16） ----------
const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function parseChunks(buf) {
  const chunks = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.slice(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function decodeRgba(buf) {
  const chunks = parseChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('not png');
  const w = ihdr.data.readUInt32BE(0);
  const h = ihdr.data.readUInt32BE(4);
  const bd = ihdr.data[8];
  const ct = ihdr.data[9];
  if (ihdr.data[12] !== 0) throw new Error('interlaced');
  if (bd !== 8) throw new Error('bitDepth ' + bd);
  const ch = CH[ct];
  if (!ch) throw new Error('colorType ' + ct);

  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const rb = w * ch;
  const bpp = ch;
  const recon = Buffer.alloc(rb);
  const prior = Buffer.alloc(rb);
  const out = Buffer.alloc(w * h * 4);
  const plte = chunks.find((c) => c.type === 'PLTE');
  const trns = chunks.find((c) => c.type === 'tRNS');
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (rb + 1)];
    const line = raw.subarray(y * (rb + 1) + 1, (y + 1) * (rb + 1));
    for (let x = 0; x < rb; x++) {
      const l = x >= bpp ? recon[x - bpp] : 0;
      const up = prior[x];
      const ul = x >= bpp ? prior[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += l;
      else if (ft === 2) v += up;
      else if (ft === 3) v += (l + up) >> 1;
      else if (ft === 4) v += paeth(l, up, ul);
      recon[x] = v & 255;
    }
    // 展开到 RGBA（调色板图 ct3 → PLTE/tRNS 查表）
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 6) {
        recon.copy(out, o, x * 4, x * 4 + 4);
      } else if (ct === 2) {
        out[o] = recon[x * 3]; out[o + 1] = recon[x * 3 + 1]; out[o + 2] = recon[x * 3 + 2]; out[o + 3] = 255;
      } else if (ct === 0) {
        out[o] = out[o + 1] = out[o + 2] = recon[x]; out[o + 3] = 255;
      } else if (ct === 4) {
        out[o] = out[o + 1] = out[o + 2] = recon[x * 2]; out[o + 3] = recon[x * 2 + 1];
      } else if (ct === 3) {
        const idx = recon[x];
        const base = idx * 3;
        out[o] = plte.data[base];
        out[o + 1] = plte.data[base + 1];
        out[o + 2] = plte.data[base + 2];
        out[o + 3] = trns && idx < trns.data.length ? trns.data[idx] : 255;
      }
    }
    recon.copy(prior);
  }
  return { w, h, rgba: out };
}

function diffRgba(a, b) {
  const n = a.length / 4;
  let maxD = 0, any = 0, over8 = 0;
  for (let p = 0; p < n; p++) {
    let pd = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[p * 4 + c] - b[p * 4 + c]);
      if (d > pd) pd = d;
    }
    if (pd > maxD) maxD = pd;
    if (pd > 0) any++;
    if (pd > 8) over8++;
  }
  return { maxD, anyPct: (any / n) * 100, over8Pct: (over8 / n) * 100 };
}

// ---------- 文件收集 / 备份 ----------
function collect() {
  const files = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.png$/i.test(name)) files.push(p);
    }
  })(path.join(ROOT, 'src'));
  return files.map((f) => ({ f, size: fs.statSync(f).size })).sort((a, b) => b.size - a.size);
}

function backupPath(rel) {
  return path.join(BACKUP_DIR, rel.split(path.sep).join('__'));
}

function doRestore() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('无备份目录，无需回滚');
    return;
  }
  let n = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const target = path.join(ROOT, ...name.split('__'));
    if (fs.existsSync(path.dirname(target))) {
      fs.copyFileSync(path.join(BACKUP_DIR, name), target);
      n++;
    }
  }
  console.log(`已回滚 ${n} 个文件（备份仍保留在 ${BACKUP_DIR}，确认无误后可删除）`);
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--restore')) {
    doRestore();
    return;
  }
  const apply = args.includes('--apply');
  const topIdx = args.indexOf('--top');
  const top = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) || 0 : 0;

  const key = getKey();
  if (!key) {
    console.error('未找到 API key，二选一：');
    console.error('  1) echo 你的key > .tmp/tinify.key');
    console.error('  2) export TINIFY_KEY=你的key');
    console.error('key 免费获取：https://tinypng.com/developers 邮箱注册 → Dashboard 复制');
    process.exit(1);
  }

  const all = collect();
  const list = all.filter((x) => x.size >= MIN_SIZE).slice(0, top > 0 ? top : undefined);
  const skipped = all.length - list.length;

  console.log(`待处理 ${list.length} 张（跳过 <2KB 小图 ${skipped} 张）${top > 0 ? `【--top ${top}】` : ''}`);
  console.log(`模式：${apply ? 'APPLY（写盘，写前自动备份）' : 'DRY-RUN（不写盘）'}  ⚠️ 上传即消耗配额，dry-run 也计数\n`);

  if (apply && !fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  let totalBefore = 0, totalAfter = 0, okN = 0, keepN = 0, failN = 0, quota = '?';
  for (const { f, size } of list) {
    const rel = path.relative(ROOT, f);
    process.stdout.write(`${rel} (${(size / 1024).toFixed(1)}K) ... `);
    try {
      const orig = fs.readFileSync(f);
      const { url, count } = await shrink(orig, key);
      if (count) quota = count;
      const outBuf = await download(url);

      if (outBuf.length >= size - SAVE_THRESHOLD) {
        console.log(`KEEP（结果 ${(outBuf.length / 1024).toFixed(1)}K 不小于原图，保留）  配额已用 ${quota}`);
        keepN++; totalBefore += size; totalAfter += size;
        continue;
      }

      let diff = null;
      try {
        const a = decodeRgba(orig);
        const b = decodeRgba(outBuf);
        if (a.w === b.w && a.h === b.h) diff = diffRgba(a.rgba, b.rgba);
      } catch (e) { /* 差异统计失败不阻塞主流程 */ }

      const pct = ((1 - outBuf.length / size) * 100).toFixed(1);
      const dstr = diff
        ? `｜色差 max ${diff.maxD}/255 · 变化像素 ${diff.anyPct.toFixed(1)}% · >8色差 ${diff.over8Pct.toFixed(1)}%`
        : '｜(差异统计不可用)';
      if (apply) {
        fs.copyFileSync(f, backupPath(rel));
        fs.writeFileSync(f, outBuf);
      }
      console.log(
        `${apply ? 'OK' : 'OK(dry)'} → ${(outBuf.length / 1024).toFixed(1)}K (-${pct}%)${dstr}  配额已用 ${quota}`
      );
      okN++; totalBefore += size; totalAfter += outBuf.length;
    } catch (e) {
      console.log(`FAIL：${e.message}`);
      failN++; totalBefore += size; totalAfter += size;
    }
  }

  console.log('----------------------------------------');
  if (totalBefore > 0) {
    console.log(
      `成功 ${okN} / 保留 ${keepN} / 失败 ${failN}：${(totalBefore / 1024).toFixed(1)}K → ${(totalAfter / 1024).toFixed(1)}K` +
      `（-${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%）｜本月配额已用 ${quota}/500`
    );
  }
  if (apply) {
    console.log(`回滚命令：node .tmp/tinify-compress.js --restore（备份在 .tmp/tinify-backup/）`);
    console.log('建议写盘后跑 npm run build（Node 16）确认产物正常');
  } else {
    console.log('\n确认差异报告可接受后，加 --apply 写盘。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
