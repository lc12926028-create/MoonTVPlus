/* B 站听书后端（服务端专用）.
 *
 * 内容只取 B 站公开视频，不存、不改、不二次分发；不登录（游客态）。
 * 搜索与筛选规则参考开源项目 fengqiao57/abts（MIT 协议）。
 *
 * 注意：不要在这里直调 B 站接口——Cloudflare Workers 的出口 IP 被 B 站
 * 风控拦住，nav 拿不到 WBI 密钥，线上稳定报 -401「B 站初始化失败」
 *（2026-11-26 实测：本机出口代理调 nav/搜索/pagelist 全通，Worker 出口
 * 全灭；不带 WBI 的旧搜索接口回的也不是 JSON，已死）。
 * B 站调用走本机桥 bili-bridge（~/workspace/bili-bridge/，经出口代理），
 * 对外是 Cloudflare Tunnel bili.moontvplus.top；桥里有完整的 WBI 签名、
 * 搜索过滤、章节逻辑（1:1 移植自本文件旧版）。本站只做透传 + 短缓存。
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

// 听书桥（本机服务，经 Cloudflare Tunnel 对外）：搜索 / 热门 / 章节
const BILI_BRIDGE = 'https://bili.moontvplus.top';

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

export function parseDurationSeconds(duration: unknown): number {
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
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- 桥透传 ----------

/** 桥一律回 200 信封 {code, data?, error?, retryable?}。 */
interface BridgeEnvelope<T> {
  code?: number;
  data?: T;
  error?: string;
  retryable?: boolean;
}

const searchCache = new Map<
  string,
  { at: number; value: { books: BiliBook[]; total: number } }
>();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

const pagelistCache = new Map<string, { at: number; value: BiliChapter[] }>();
const PAGELIST_CACHE_TTL = 10 * 60 * 1000;

async function bridgeGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BILI_BRIDGE}${path}`, {
      headers: { 'User-Agent': 'MoonTVPlus/tingshu' },
    });
  } catch {
    throw new BiliError(-1, '网络请求失败，请点一下重试', true);
  }
  let body: BridgeEnvelope<T>;
  try {
    body = (await res.json()) as BridgeEnvelope<T>;
  } catch {
    throw new BiliError(-1, '网络请求失败，请点一下重试', true);
  }
  if (body.code !== 0 || body.data == null) {
    throw new BiliError(
      typeof body.code === 'number' ? body.code : -1,
      body.error || '搜索失败，请点一下重试',
      body.retryable !== false
    );
  }
  return body.data;
}

/** 搜有声书（只返回听书类内容，过滤规则在桥里）。 */
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
  const params = new URLSearchParams({ q: kw, page: String(page) });
  if (order) params.set('order', order);
  const value = await bridgeGet<{ books: BiliBook[]; total: number }>(
    `/api/search?${params.toString()}`
  );
  searchCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** 热门推荐：有声小说按播放量排序（桥里翻页凑量 + 按标题去重）。 */
export async function rankHotNovels(limit = 30): Promise<BiliBook[]> {
  const data = await bridgeGet<{ books: BiliBook[]; total: number }>(
    '/api/search?hot=1'
  );
  return data.books.slice(0, limit);
}

/** 取一本有声书的章节列表（分P = 章节）。 */
export async function getBiliPageList(bvid: string): Promise<BiliChapter[]> {
  const cached = pagelistCache.get(bvid);
  if (cached && Date.now() - cached.at < PAGELIST_CACHE_TTL) {
    return cached.value;
  }
  const data = await bridgeGet<{ bvid: string; chapters: BiliChapter[] }>(
    `/api/pagelist?bvid=${encodeURIComponent(bvid)}`
  );
  pagelistCache.set(bvid, { at: Date.now(), value: data.chapters });
  return data.chapters;
}
