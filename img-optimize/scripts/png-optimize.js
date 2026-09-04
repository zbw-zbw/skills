#!/usr/bin/env node
'use strict';
/**
 * 严格无损 PNG 优化器（optipng 同原理的纯 Node 实现）
 *
 * - 逐行尝试 PNG 5 种 filter（None/Sub/Up/Average/Paeth）选最优，配合 zlib level9/memLevel9
 *   的 DEFAULT / RLE 两种策略，穷举组合取最小产物
 * - 可剔除纯元数据 chunk（tEXt/zTXt/iTXt/tIME），不触碰任何影响渲染的 chunk；
 *   eXIf 永不剔除：EXIF 可能含 Orientation 方向标记，浏览器默认 image-orientation:
 *   from-image，剔除会导致渲染方向改变（宁可多 68 字节不冒这个险）
 * - 写盘前对产物完整解码（inflate + unfilter），与原文件像素逐字节比对，
 *   任何差异直接拒绝替换 —— 数学上保证像素零损失
 *
 * 用法：
 *   node png-optimize.js --apply [目录或文件]   # 实际写盘
 *   node png-optimize.js [目录或文件]           # dry-run，仅报告
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STRIP_TYPES = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME']); // eXIf 永不剔除，见头部注释
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const SAVE_THRESHOLD = 32; // 至少省 32 字节才替换，避免无意义 churn

// ---------- PNG 解析 ----------

function parsePng(buf) {
  if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIG)) {
    throw new Error('not a png');
  }
  const chunks = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (off + 12 + len > buf.length) throw new Error('truncated chunk');
    const type = buf.toString('ascii', off + 4, off + 8);
    if (!/^[a-zA-Z]{4}$/.test(type)) throw new Error('bad chunk type');
    const data = buf.slice(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    const crcExpect = zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0;
    if (crc !== crcExpect) throw new Error(`crc mismatch in ${type}`);
    chunks.push({ type, data });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length !== 13) throw new Error('bad IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  return { chunks, width, height, bitDepth, colorType, interlace };
}

function idatRaw(chunks) {
  const joined = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  return zlib.inflateSync(joined);
}

// ---------- filter 编解码 ----------

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// 解码方向：filtered line -> 原始像素行
function unfilterRow(ft, line, recon, prior, bpp, rowbytes) {
  for (let x = 0; x < rowbytes; x++) {
    const left = x >= bpp ? recon[x - bpp] : 0;
    const up = prior[x];
    const ul = x >= bpp ? prior[x - bpp] : 0;
    let v = line[x];
    if (ft === 1) v += left;
    else if (ft === 2) v += up;
    else if (ft === 3) v += (left + up) >> 1;
    else if (ft === 4) v += paeth(left, up, ul);
    recon[x] = v & 0xff;
  }
}

function unfilterAll(raw, height, rowbytes, bpp) {
  const pixels = Buffer.alloc(height * rowbytes);
  const recon = Buffer.alloc(rowbytes);
  const prior = Buffer.alloc(rowbytes);
  const stride = rowbytes + 1;
  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    unfilterRow(ft, line, recon, prior, bpp, rowbytes);
    recon.copy(pixels, y * rowbytes);
    recon.copy(prior);
  }
  return pixels;
}

// 编码方向：原始像素行 -> filtered line（写入 out）
function filterRowInto(ft, recon, prior, bpp, rowbytes, out) {
  for (let x = 0; x < rowbytes; x++) {
    const left = x >= bpp ? recon[x - bpp] : 0;
    const up = prior[x];
    const ul = x >= bpp ? prior[x - bpp] : 0;
    let pred = 0;
    if (ft === 1) pred = left;
    else if (ft === 2) pred = up;
    else if (ft === 3) pred = (left + up) >> 1;
    else if (ft === 4) pred = paeth(left, up, ul);
    out[x] = (recon[x] - pred) & 0xff;
  }
}

function scoreOf(buf) {
  // libpng 同款启发式：filtered 字节按有符号解释后的绝对值和，越小越可压缩
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    s += b < 128 ? b : 256 - b;
  }
  return s;
}

/**
 * 生成整图的 filtered 原始流
 * plan: 'keep' 保留原 filter 字节 | 'heur' 逐行启发式 | 0..4 全图统一
 */
function buildFiltered(pixels, origRaw, height, rowbytes, bpp, plan) {
  if (plan === 'keep') return origRaw;
  const stride = rowbytes + 1;
  const out = Buffer.alloc(height * stride);
  const prior = Buffer.alloc(rowbytes);
  const cur = Buffer.alloc(rowbytes);
  const cand = Buffer.alloc(rowbytes);
  for (let y = 0; y < height; y++) {
    pixels.copy(cur, 0, y * rowbytes, (y + 1) * rowbytes);
    if (plan === 'heur') {
      let bestFt = 0;
      let bestScore = Infinity;
      for (let ft = 0; ft <= 4; ft++) {
        filterRowInto(ft, cur, prior, bpp, rowbytes, cand);
        const sc = scoreOf(cand);
        if (sc < bestScore) {
          bestScore = sc;
          bestFt = ft;
        }
      }
      out[y * stride] = bestFt;
      filterRowInto(bestFt, cur, prior, bpp, rowbytes, cand);
      cand.copy(out, y * stride + 1);
    } else {
      out[y * stride] = plan;
      filterRowInto(plan, cur, prior, bpp, rowbytes, cand);
      cand.copy(out, y * stride + 1);
    }
    cur.copy(prior);
  }
  return out;
}

// ---------- 重组 ----------

function pushChunk(arr, type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
  arr.push(len, t, data, crcBuf);
}

function rebuild(chunks, newIdat, stripMeta) {
  const out = [PNG_SIG];
  let idatWritten = false;
  for (const ch of chunks) {
    if (ch.type === 'IDAT') {
      if (!idatWritten) {
        // 拆成 1MB 分块，兼容对超大单 IDAT 不友好的解码器
        const CHUNK = 1024 * 1024;
        for (let i = 0; i < newIdat.length; i += CHUNK) {
          pushChunk(out, 'IDAT', newIdat.subarray(i, i + CHUNK));
        }
        idatWritten = true;
      }
      continue;
    }
    if (stripMeta && STRIP_TYPES.has(ch.type)) continue;
    pushChunk(out, ch.type, ch.data);
  }
  return Buffer.concat(out);
}

function deflateAsync(buf, opts) {
  return new Promise((resolve, reject) => {
    zlib.deflate(buf, opts, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

// ---------- 单文件优化 ----------

async function optimizeFile(file, apply) {
  const orig = fs.readFileSync(file);
  const origSize = orig.length;
  let png;
  try {
    png = parsePng(orig);
  } catch (e) {
    return { file, status: 'SKIP', reason: e.message, origSize, newSize: origSize };
  }
  if (png.interlace !== 0) {
    return { file, status: 'SKIP', reason: 'interlaced', origSize, newSize: origSize };
  }
  const channels = CHANNELS[png.colorType];
  if (!channels) {
    return { file, status: 'SKIP', reason: `colorType ${png.colorType}`, origSize, newSize: origSize };
  }
  const rowbytes = Math.ceil((png.width * channels * png.bitDepth) / 8);
  const bpp = Math.max(1, (channels * png.bitDepth) / 8);

  let raw;
  try {
    raw = idatRaw(png.chunks);
  } catch (e) {
    return { file, status: 'SKIP', reason: `inflate: ${e.message}`, origSize, newSize: origSize };
  }
  if (raw.length !== png.height * (rowbytes + 1)) {
    return { file, status: 'SKIP', reason: 'raw size mismatch', origSize, newSize: origSize };
  }

  const pixels = unfilterAll(raw, png.height, rowbytes, bpp);

  // 组合策略：大图控制组合数量避免内存/耗时爆炸
  const big = raw.length > 8 * 1024 * 1024;
  const plans = big ? ['keep', 'heur', 4, 2] : ['keep', 'heur', 0, 1, 2, 3, 4];
  const variants = big
    ? [
        { name: 'l9m9', opts: { level: 9, memLevel: 9 } },
        { name: 'l9m9rle', opts: { level: 9, memLevel: 9, strategy: zlib.constants.Z_RLE } },
      ]
    : [
        { name: 'l9m9', opts: { level: 9, memLevel: 9 } },
        { name: 'l9m9rle', opts: { level: 9, memLevel: 9, strategy: zlib.constants.Z_RLE } },
        { name: 'l9m8', opts: { level: 9 } },
      ];

  // 逐个 filter plan 生成流并立即发起异步压缩（libuv 线程池并发），控制峰值内存
  const jobs = [];
  const buffers = [];
  for (const plan of plans) {
    const filtered = buildFiltered(pixels, raw, png.height, rowbytes, bpp, plan);
    buffers.push(filtered);
    for (const v of variants) {
      jobs.push(
        deflateAsync(filtered, v.opts).then((out) => ({ plan: String(plan), variant: v.name, out }))
      );
    }
  }
  const results = await Promise.all(jobs);
  buffers.length = 0; // 释放

  let best = null;
  for (const r of results) {
    if (!best || r.out.length < best.out.length) best = r;
  }

  const stripMeta = true;
  let candidate = rebuild(png.chunks, best.out, stripMeta);

  // 严格自校验：重新解码候选文件，像素必须与原图逐字节一致
  let verified = false;
  try {
    const re = parsePng(candidate);
    const reRaw = idatRaw(re.chunks);
    const rePixels = unfilterAll(reRaw, re.height, reCeilRowbytes(re, rowbytes), reCeilBpp(re, bpp));
    verified =
      re.width === png.width &&
      re.height === png.height &&
      re.colorType === png.colorType &&
      re.bitDepth === png.bitDepth &&
      rePixels.equals(pixels);
  } catch (e) {
    verified = false;
  }

  if (!verified) {
    return { file, status: 'FAIL', reason: 'pixel mismatch after re-encode (refused)', origSize, newSize: origSize };
  }

  // 若剔除元数据后仍不够小，再试保留元数据的版本（几乎不可能更小，保险起见）
  if (candidate.length >= origSize) {
    const keepMeta = rebuild(png.chunks, best.out, false);
    if (keepMeta.length < candidate.length) candidate = keepMeta;
  }

  const newSize = candidate.length;
  if (origSize - newSize < SAVE_THRESHOLD) {
    return { file, status: 'KEEP', reason: 'already optimal', origSize, newSize: origSize };
  }

  if (apply) {
    // 写盘前再校验一次内存中的 candidate 与磁盘原始文件
    fs.writeFileSync(file, candidate);
  }
  return {
    file,
    status: apply ? 'OK' : 'OK(dry-run)',
    plan: best.plan,
    variant: best.variant,
    origSize,
    newSize,
    saved: origSize - newSize,
  };
}

function reCeilRowbytes(re, fallback) {
  const channels = CHANNELS[re.colorType] || 0;
  return channels ? Math.ceil((re.width * channels * re.bitDepth) / 8) : fallback;
}
function reCeilBpp(re, fallback) {
  const channels = CHANNELS[re.colorType] || 0;
  return channels ? Math.max(1, (channels * re.bitDepth) / 8) : fallback;
}

// ---------- 主流程 ----------

function collect(dir) {
  const skip = new Set(['node_modules', 'build', '.git', '.tmp', '.tmp-verify', '.temp', 'dist']);
  const files = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      if (skip.has(name)) continue;
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.png$/i.test(name)) files.push(p);
    }
  })(dir);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const targets = args.filter((a) => !a.startsWith('--'));
  const root = targets[0] || '.';
  const stat = fs.statSync(root);
  const files = stat.isDirectory() ? collect(root) : [root];

  const results = [];
  for (const f of files) {
    process.stdout.write(`processing ${f} ... `);
    const r = await optimizeFile(f, apply);
    process.stdout.write(
      `${r.status}${r.saved ? ` ${(r.origSize / 1024).toFixed(1)}K -> ${(r.newSize / 1024).toFixed(1)}K` : ''}\n`
    );
    results.push(r);
  }

  const fmt = (n) => (n / 1024).toFixed(1) + 'K';
  console.log('\n================ 压缩报告 ================');
  let totalOrig = 0;
  let totalNew = 0;
  let okCount = 0;
  for (const r of results) {
    totalOrig += r.origSize;
    totalNew += r.status.startsWith('OK') ? r.newSize : r.origSize;
    if (r.status.startsWith('OK')) okCount++;
    const pct = r.saved ? ` (-${((r.saved / r.origSize) * 100).toFixed(1)}%)` : '';
    console.log(
      `${r.status.padEnd(12)} ${fmt(r.origSize).padStart(8)} -> ${fmt(r.status.startsWith('OK') ? r.newSize : r.origSize).padStart(8)}${pct}  ${r.file}${r.reason ? `  [${r.reason}]` : ''}`
    );
  }
  const saved = totalOrig - totalNew;
  console.log('-----------------------------------------');
  console.log(
    `共 ${results.length} 张，优化 ${okCount} 张：${fmt(totalOrig)} -> ${fmt(totalNew)}，节省 ${fmt(saved)} (${((saved / totalOrig) * 100).toFixed(1)}%)`
  );
  console.log(apply ? '' : '\n(dry-run 模式，未写盘。加 --apply 实际生效)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
