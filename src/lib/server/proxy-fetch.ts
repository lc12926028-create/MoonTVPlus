/**
 * 代理路由共用的上游拉取：
 * - 仅对「响应头等待」限时（默认 15s）：拿到响应头后清除计时器，body 流式透传不再受限。
 *   之前无任何超时（挂住）或整段超时（分片稍大/源稍慢就被切断），与 LibreTV /api/proxy 的
 *   header-only 超时同款。
 * - 上游限流（429）：立即重试只会再吃 429，按 Retry-After 或退避延迟后重试 1 次。
 *   仍 429 时返回该响应，由调用方决定是否向客户端透传 429 状态码。
 */

const DEFAULT_HEADER_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  // 夹在 1s~8s，避免上游给的超长等待把请求挂死
  return Math.min(Math.max(seconds * 1000, 1000), 8000);
}

export interface UpstreamFetchOptions {
  /** 响应头等待超时（毫秒），默认 15000；传 0 表示不限时 */
  headerTimeoutMs?: number;
  /** 429 后的最大重试次数，默认 1 */
  maxRetries?: number;
}

export async function fetchUpstreamWithRetry(
  url: string,
  init: RequestInit = {},
  options: UpstreamFetchOptions = {}
): Promise<Response> {
  const headerTimeoutMs = options.headerTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer =
      headerTimeoutMs > 0 ? setTimeout(() => controller.abort(), headerTimeoutMs) : null;
    // 调用方若自带 signal（客户端断开等），一并链入
    if (init.signal) {
      if (init.signal.aborted) controller.abort(init.signal.reason);
      else init.signal.addEventListener('abort', () => controller.abort(init.signal?.reason), { once: true });
    }
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    // 拿到响应头即不限时：body 由调用方流式消费，不再受该计时器约束
    if (res.status === 429 && attempt < maxRetries) {
      const waitMs = parseRetryAfterMs(res) ?? 3000 * (attempt + 1);
      try {
        await res.body?.cancel();
      } catch {
        /* 忽略 */
      }
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    lastResponse = res;
    break;
  }
  // 正常路径一定有响应；防御性兜底
  if (!lastResponse) throw new Error('上游请求失败');
  return lastResponse;
}
