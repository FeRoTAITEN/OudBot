/** Run async tasks with a concurrency cap (avoids Discord rate limits). */
async function runPool(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [...items];
  if (!list.length) return [];
  const limit = Math.max(1, concurrency || 1);
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const idx = next++;
      try {
        results[idx] = await fn(list[idx], idx);
      } catch (err) {
        results[idx] = { error: err };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

module.exports = { runPool };
