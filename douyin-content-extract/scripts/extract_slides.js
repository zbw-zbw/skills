// 在抖音视频页上下文执行（browser connector javascript_tool）。
// 返回：去重后的原图 URL 数组 JSON 字符串（DOM 顺序 = 播放顺序）。
// 过滤规则：仅 aweme_images 业务图；naturalWidth<720 的小图/图标不要。
(() => {
  const seen = new Set();
  const urls = [];
  document.querySelectorAll('img').forEach((img) => {
    const src = img.src || '';
    if (!src.includes('aweme_images')) return;
    if (seen.has(src)) return;
    if ((img.naturalWidth || img.width || 0) < 720) return;
    seen.add(src);
    urls.push(src);
  });
  return JSON.stringify(urls);
})();
