/* B 站听书后端（服务端专用）.
 *
 * 内容只取 B 站公开视频，不存、不改、不二次分发；不登录（游客态）。
 * 搜索与筛选规则参考开源项目 fengqiao57/abts（MIT 协议）：
 * lib/services/bili_api.dart、lib/core/network/bili_client.dart。
 * 分类词表、听书判定规则、WBI 签名流程均按该项目实现方式移植。
 *
 * 注意：Cloudflare Workers 没有 node:crypto 的 MD5，WBI 签名用的 MD5
 * 在这里用纯 TS 实现（RFC 1321），不要改成其它哈希。
 */

/** B 站返回的风控/业务错误；retryable=true 表示前端可以提示“再试一次”。 */
export class BiliError extends Error {
  code: number;
  retryable: boolean;
  constructor(code: number, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

// ---------- MD5（纯 TS，RFC 1321） ----------

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
  0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
  0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const withPadding = new Uint8Array(
    Math.ceil((bytes.length + 9) / 64) * 64
  );
  withPadding.set(bytes);
  withPadding[bytes.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  // 长度放最后 8 字节（小端，低 32 位 + 高 32 位）
  view.setUint32(withPadding.length - 8, bitLen >>> 0, true);
  view.setUint32(
    withPadding.length - 4,
    Math.floor(bitLen / 0x100000000),
    true
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const leftRotate = (x: number, c: number) =>
    ((x << c) | (x >>> (32 - c))) >>> 0;

  for (let off = 0; off < withPadding.length; off += 64) {
    const m: number[] = [];
    for (let i = 0; i < 16; i++) {
      m.push(view.getUint32(off + i * 4, true));
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      b =
        (b + leftRotate((a + f + MD5_K[i] + m[g]) >>> 0, MD5_S[i])) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const word = (x: number) =>
    [x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >> 24) & 0xff]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  return word(a0) + word(b0) + word(c0) + word(d0);
}

// ---------- WBI 签名 ----------

// B 站 WBI 的 mixin key 打乱表（公开算法，abts 的 wbi_signer.dart 同款）
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
  49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24,
  55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52,
];

function getMixinKey(imgKey: string, subKey: string): string {
  const s = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((i) => s[i] || '')
    .join('')
    .slice(0, 32);
}

function keyFromUrl(url: string): string {
  const name = url.split('/').pop() || '';
  return name.split('.')[0] || '';
}

/** 给请求参数加 WBI 签名（wts + w_rid），返回新对象。 */
export function wbiSign(
  params: Record<string, string | number>,
  imgUrl: string,
  subUrl: string
): Record<string, string> {
  const mixinKey = getMixinKey(keyFromUrl(imgUrl), keyFromUrl(subUrl));
  const signed: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    signed[k] = String(v);
  }
  signed.wts = String(Math.floor(Date.now() / 1000));
  const sorted = Object.keys(signed).sort();
  const query = sorted
    .map((k) => `${k}=${encodeURIComponent(signed[k])}`)
    .join('&');
  signed.w_rid = md5Hex(query + mixinKey);
  return signed;
}

// ---------- 常量 ----------

const BILI_HOME = 'https://www.bilibili.com';
const BILI_API = 'https://api.bilibili.com';
const SEARCH_HOME = 'https://search.bilibili.com';
const NAV_URL = `${BILI_API}/x/web-interface/nav`;
const SEARCH_TYPE_URL = `${BILI_API}/x/web-interface/wbi/search/type`;
const PAGELIST_URL = `${BILI_API}/x/player/pagelist`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 游客请求最小间隔（abts 取 450ms，太密容易触发 -352/-412）
const MIN_GAP_MS = 450;

// ---------- 内存态：Cookie 与 WBI 密钥（随实例复用，进程重启即失效） ----------

const cookieJar = new Map<string, string>();
let wbiKeys: { imgUrl: string; subUrl: string; fetchedAt: number } | null =
  null;
let lastReqAt = 0;

function genBuvid3(): string {
  const uuid = crypto.randomUUID().toUpperCase();
  const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return `${uuid}${suffix}infoc`;
}

function mergeSetCookie(setCookie: string | string[] | null) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const item of list) {
    const pair = item.split(';')[0].trim();
    const eq = pair.indexOf('=');
    if (eq > 0) {
      cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

function cookieHeader(): string {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function throttle() {
  const now = Date.now();
  const wait = MIN_GAP_MS - (now - lastReqAt);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastReqAt = Date.now();
}

function headersToObject(
  headers: Headers
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie') {
      const prev = out[k];
      if (Array.isArray(prev)) prev.push(value);
      else if (typeof prev === 'string') out[k] = [prev, value];
      else out[k] = [value];
    } else {
      out[k] = value;
    }
  });
  return out;
}

/** 预热：访问 B 站首页种 buvid，并从 nav 拉 WBI 密钥。失败静默，由调用方重试兜底。 */
async function warmup() {
  try {
    if (!cookieJar.get('buvid3')) cookieJar.set('buvid3', genBuvid3());
    if (!cookieJar.get('buvid4')) cookieJar.set('buvid4', genBuvid3());
    const res = await fetch(BILI_HOME + '/', {
      headers: { 'User-Agent': USER_AGENT, Referer: BILI_HOME },
    });
    mergeSetCookie(
      (headersToObject(res.headers)['set-cookie'] as string[] | undefined) ??
        null
    );
    await refreshWbiKeys();
  } catch {
    // 预热失败不抛错：后续请求仍可尝试，失败时再报
  }
}

async function refreshWbiKeys() {
  try {
    const res = await fetch(NAV_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: BILI_HOME,
        Cookie: cookieHeader(),
      },
    });
    mergeSetCookie(
      (headersToObject(res.headers)['set-cookie'] as string[] | undefined) ??
        null
    );
    const data = (await res.json()) as {
      code?: number;
      data?: { wbi_img?: { img_url?: string; sub_url?: string } };
    };
    const img = data?.data?.wbi_img;
    if (img?.img_url && img?.sub_url) {
      wbiKeys = {
        imgUrl: img.img_url,
        subUrl: img.sub_url,
        fetchedAt: Date.now(),
      };
    }
  } catch {
    // 拉不到 WBI 密钥时保持旧值，由调用方按失败处理
  }
}

function wbiKeysFresh(): boolean {
  if (!wbiKeys) return false;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return wbiKeys.fetchedAt >= day.getTime();
}

async function ensureWbiKeys() {
  if (!wbiKeysFresh()) {
    await warmup();
    if (!wbiKeysFresh()) {
      await refreshWbiKeys();
    }
  }
  if (!wbiKeys) {
    throw new BiliError(-401, 'B 站初始化失败，请检查网络后重试', true);
  }
  return wbiKeys;
}

async function biliGet(
  url: string,
  params: Record<string, string | number>,
  opts: { useWbi?: boolean; referer?: string; origin?: string } = {}
): Promise<Record<string, unknown>> {
  await throttle();
  let q = { ...params };
  if (opts.useWbi) {
    const keys = await ensureWbiKeys();
    q = wbiSign(q, keys.imgUrl, keys.subUrl);
  }
  const full =
    url + '?' + new URLSearchParams(
      Object.entries(q).map(([k, v]) => [k, String(v)])
    ).toString();
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: opts.referer || BILI_HOME,
  };
  if (opts.origin) headers.Origin = opts.origin;
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(full, { headers });
  mergeSetCookie(
    (headersToObject(res.headers)['set-cookie'] as string[] | undefined) ??
      null
  );
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BiliError(res.status, `B 站返回了非 JSON（HTTP ${res.status}）`, true);
  }
}

// ---------- 听书判定（照搬 abts 的过滤规则） ----------

const AUDIO_HINTS = [
  '有声小说', '有声书', '有声剧', '有声读物', '有声', '听书', '评书',
  '相声', '广播剧', '演播', '朗读', '诵读', '长书', '连播', '说书',
  '单口', '播讲', '多人剧', '小说剧',
];

const NOISE_HINTS = [
  '一口气看完', '漫推', '漫画', '解说', '讲解', '解读', '动画', '鬼畜',
  '混剪', '沙雕', '速看', 'reaction', '预告', '游戏实况', '配音秀',
];

const PODCAST_HINTS = [
  '播客', '电台', '对谈', '访谈', '脱口秀', '圆桌', '茶话会',
];

const GENRE_HINTS = [
  '评书', '相声', '广播剧', '听书', '演播', '朗读', '诵读', '长书',
  '连播', '说书', '单口', '播讲',
];

// B 站「动态漫·广播剧」分区（听书内容主分区）
const AUDIO_TYPE_ID = 195;

function hasAny(hints: string[], s: string): boolean {
  return hints.some((h) => s.includes(h));
}

/** abts 的判定：噪音词一律剔除；标题含听书词且 ≥5 分钟，或 195 分区且 ≥10 分钟，等等。 */
function isAudiobookItem(
  m: Record<string, unknown>,
  keyword: string
): boolean {
  const title = String(m.title ?? '');
  const meta = `${String(m.description ?? '')} ${String(m.tag ?? '')}`;
  if (hasAny(NOISE_HINTS, `${title} ${meta}`)) return false;
  const seconds = parseDurationSeconds(m.duration);
  if (hasAny(AUDIO_HINTS, title) && seconds >= 300) return true;
  const typeid = Number(m.typeid ?? 0);
  if (typeid === AUDIO_TYPE_ID && seconds >= 600) return true;
  if (hasAny(AUDIO_HINTS, meta) && seconds >= 1800) return true;
  if (GENRE_HINTS.some((h) => keyword.includes(h)) && seconds >= 1800)
    return true;
  if (hasAny(PODCAST_HINTS, title) && seconds >= 600) return true;
  return false;
}

export function parseDurationSeconds(
  duration: unknown
): number {
  if (typeof duration === 'number') return duration;
  const s = String(duration ?? '').trim();
  if (!s) return 0;
  const parts = s.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let total = 0;
  for (const p of parts) total = total * 60 + p;
  return total;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stripEm(s: string): string {
  return s
    .replace(/<em[^>]*>/gi, '')
    .replace(/<\/em>/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizePic(pic: string): string {
  if (!pic) return '';
  if (pic.startsWith('//')) return `https:${pic}`;
  if (pic.startsWith('http://')) return pic.replace('http://', 'https://');
  return pic;
}

export interface BiliBook {
  bvid: string;
  aid: number;
  title: string;
  cleanTitle: string;
  pic: string;
  duration: number;
  durationText: string;
  author: string;
  mid: number;
  play: number;
  pubdate: number;
  desc: string;
}

export interface BiliChapter {
  page: number;
  cid: number;
  part: string;
  duration: number;
}

function bookFromSearch(m: Record<string, unknown>): BiliBook | null {
  const bvid = String(m.bvid ?? '');
  const aid = Number(m.aid ?? 0);
  if (!bvid || !aid) return null;
  const title = stripEm(String(m.title ?? ''));
  const duration = parseDurationSeconds(m.duration);
  const stat = (m.stat as Record<string, unknown>) || {};
  return {
    bvid,
    aid,
    title,
    cleanTitle: title,
    pic: normalizePic(String(m.pic ?? '')),
    duration,
    durationText: formatDuration(duration),
    author: String(m.author ?? ''),
    mid: Number(m.mid ?? 0),
    play: Number(stat.view ?? 0),
    pubdate: Number(m.pubdate ?? 0),
    desc: stripEm(String(m.description ?? '')),
  };
}

// ---------- 搜索 ----------

const searchCache = new Map<
  string,
  { at: number; value: { books: BiliBook[]; total: number } }
>();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

async function searchRaw(
  keyword: string,
  page: number,
  pageSize: number,
  order?: string
): Promise<{ books: BiliBook[]; total: number; rawCount: number }> {
  let attempt = 0;
  for (;;) {
    attempt++;
    const params: Record<string, string | number> = {
      search_type: 'video',
      keyword,
      page,
      page_size: pageSize,
      platform: 'pc',
      web_location: 1430654,
    };
    if (order) params.order = order;
    const res = await biliGet(SEARCH_TYPE_URL, params, {
      useWbi: true,
      origin: SEARCH_HOME,
      referer: `${SEARCH_HOME}/video?keyword=${encodeURIComponent(keyword)}`,
    });
    const data = (res.data as Record<string, unknown>) || {};
    // v_voucher：触发极验风控，等待后重试
    if (data.result == null && data.v_voucher != null) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new BiliError(
        -412,
        'B 站验证繁忙，请点一下重试',
        true
      );
    }
    const total = Number(data.numResults ?? 0);
    const list = (data.result as unknown[]) || [];
    const books: BiliBook[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      if (!isAudiobookItem(m, keyword)) continue;
      const b = bookFromSearch(m);
      if (b) books.push(b);
    }
    return { books, total, rawCount: list.length };
  }
}

/**
 * 搜有声书（只返回听书类内容）。
 * 先用原关键词搜，命中太少时再用「关键词 有声小说」补搜一次并合并去重；
 * 补搜只在第 1 页做，避免翻页时请求翻倍触发风控。
 */
export async function searchBiliAudio(
  keyword: string,
  page = 1,
  pageSize = 20,
  order?: string
): Promise<{ books: BiliBook[]; total: number }> {
  const kw = keyword.trim();
  if (!kw) return { books: [], total: 0 };
  const cacheKey = `${kw}|${page}|${pageSize}|${order || ''}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return cached.value;
  }
  try {
    const primary = await searchRaw(kw, page, pageSize, order);
    let books = primary.books;
    let total = primary.total;
    if (page === 1 && books.length < 6 && !hasAny(AUDIO_HINTS, kw)) {
      try {
        const extra = await searchRaw(`${kw} 有声小说`, page, pageSize, order);
        const seen = new Set(books.map((b) => b.bvid));
        for (const b of extra.books) {
          if (!seen.has(b.bvid)) {
            seen.add(b.bvid);
            books.push(b);
          }
        }
        if (extra.total > total) total = extra.total;
      } catch {
        // 补搜失败不影响主结果
      }
    }
    const value = { books, total };
    searchCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (e instanceof BiliError) throw e;
    // -412/-352 类风控在 searchRaw 内已重试；其它网络错误也提示重试
    throw new BiliError(-1, '网络请求失败，请点一下重试', true);
  }
}

/** 热门推荐：有声小说按播放量排序，翻页凑量 + 按标题去重。 */
export async function rankHotNovels(
  limit = 30
): Promise<BiliBook[]> {
  const all: BiliBook[] = [];
  for (let page = 1; page <= 2; page++) {
    try {
      const { books } = await searchRaw('有声小说', page, 20, 'click');
      all.push(...books);
      if (books.length === 0) break;
    } catch {
      break;
    }
  }
  const seen = new Set<string>();
  const out: BiliBook[] = [];
  for (const b of all) {
    if (!seen.has(b.cleanTitle)) {
      seen.add(b.cleanTitle);
      out.push(b);
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- 章节（分P） ----------

const pagelistCache = new Map<
  string,
  { at: number; value: BiliChapter[] }
>();
const PAGELIST_CACHE_TTL = 10 * 60 * 1000;

export async function getBiliPageList(
  bvid: string
): Promise<BiliChapter[]> {
  const cached = pagelistCache.get(bvid);
  if (cached && Date.now() - cached.at < PAGELIST_CACHE_TTL) {
    return cached.value;
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    try {
      const res = await biliGet(PAGELIST_URL, { bvid }, { useWbi: false });
      const list = (res.data as unknown[]) || [];
      const chapters: BiliChapter[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const m = item as Record<string, unknown>;
        chapters.push({
          page: Number(m.page ?? chapters.length + 1),
          cid: Number(m.cid ?? 0),
          part: String(m.part ?? ''),
          duration: Number(m.duration ?? 0),
        });
      }
      pagelistCache.set(bvid, { at: Date.now(), value: chapters });
      return chapters;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr instanceof BiliError) throw lastErr;
  throw new BiliError(-1, '获取章节失败，请点一下重试', true);
}
