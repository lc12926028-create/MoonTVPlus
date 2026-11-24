/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 92hm.top 桥接服务客户端。
 *
 * 桥接服务跑在站点后端同侧，负责实时抓取 92hm.top（搜索 / 排行 / 更新 / 详情 /
 * 章节页图），本站把它当作一个普通漫画源接入，源 id 固定为 "hm92top"。
 * 配置走管理配置的 Hm92Config（与 SuwayomiConfig 同一套 admin_config JSON），
 * 未启用或未配置时本源静默不存在，不影响 Suwayomi 的任何路径。
 */

import { getConfig } from './config';
import {
  MangaChapter,
  MangaDetail,
  MangaRecommendResult,
  MangaSearchItem,
  MangaSource,
} from './manga.types';
import { normalizeApiBaseUrl } from './url';

export const HM92_SOURCE_ID = 'hm92top';
export const HM92_SOURCE_NAME = '92hm.top';

/** 合成源条目：与 Suwayomi 源走同一套 MangaSource 结构，混进源列表一起展示。 */
export const HM92_SOURCE_ENTRY: MangaSource = {
  id: HM92_SOURCE_ID,
  name: HM92_SOURCE_NAME,
  lang: 'zh',
  displayName: HM92_SOURCE_NAME,
};

/**
 * 桥接图片在本站图片代理里的路径方案：
 * `/api/manga/image?path=hm92:<encodeURIComponent 后的源站图片绝对地址>`
 * `hm92:` 前缀让 /api/manga/image 能把桥接图片与 Suwayomi 图片区分开。
 */
export const HM92_IMAGE_PATH_PREFIX = 'hm92:';

export function buildHm92ImageProxyUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('/api/manga/image?')) return pathOrUrl;
  return `/api/manga/image?path=${encodeURIComponent(
    `${HM92_IMAGE_PATH_PREFIX}${pathOrUrl}`
  )}`;
}

export interface ResolvedHm92Config {
  serverBaseUrl: string;
  username?: string;
  password?: string;
}

const DEFAULT_HM92_TIMEOUT_MS = Number(process.env.HM92_TIMEOUT_MS || 20000);

/**
 * 解析桥接配置：与 Suwayomi 同口径——管理配置里 Enabled 时以管理配置为准，
 * 否则回退环境变量（HM92_ENABLED / HM92_URL / HM92_USERNAME / HM92_PASSWORD）。
 * 未启用或没填服务地址时返回 null，调用方据此让本源静默消失。
 */
export async function getHm92Config(): Promise<ResolvedHm92Config | null> {
  let enabled = process.env.HM92_ENABLED === 'true';
  let serverUrl = process.env.HM92_URL || '';
  let username = process.env.HM92_USERNAME || '';
  let password = process.env.HM92_PASSWORD || '';

  try {
    const config = await getConfig();
    if (config.Hm92Config?.Enabled) {
      enabled = true;
      serverUrl = config.Hm92Config.ServerURL || serverUrl;
      username = config.Hm92Config.Username || username;
      password = config.Hm92Config.Password || password;
    }
  } catch {
    // 配置读取失败时回退到环境变量
  }

  if (!enabled || !serverUrl) {
    return null;
  }

  return {
    serverBaseUrl: normalizeApiBaseUrl(serverUrl),
    username: username || undefined,
    password: password || undefined,
  };
}

export function buildHm92AuthHeader(
  config: ResolvedHm92Config
): string | undefined {
  if (!config.username && !config.password) return undefined;
  return `Basic ${Buffer.from(
    `${config.username || ''}:${config.password || ''}`
  ).toString('base64')}`;
}

function normalizeHm92Status(status?: string): string | undefined {
  if (!status) return undefined;

  const normalized = status.trim().toUpperCase();
  switch (normalized) {
    case 'ONGOING':
      return '连载中';
    case 'COMPLETED':
      return '已完结';
    default:
      return undefined;
  }
}

interface Hm92ListItem {
  id: string | number;
  title?: string;
  cover?: string;
}

interface Hm92ListResponse {
  results?: Hm92ListItem[];
  hasNextPage?: boolean;
}

interface Hm92BookResponse {
  id: string | number;
  title?: string;
  cover?: string;
  description?: string;
  author?: string;
  status?: string;
  chapters?: Array<{ id: string | number; title?: string }>;
}

interface Hm92ChapterResponse {
  pages?: string[];
}

export class Hm92Client {
  private async request<T>(path: string): Promise<T> {
    const config = await getHm92Config();
    if (!config) {
      throw new Error('92hm.top 桥接未启用或未配置');
    }

    const authorization = buildHm92AuthHeader(config);
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`92hm 桥接请求超时(${DEFAULT_HM92_TIMEOUT_MS}ms)`)),
      DEFAULT_HM92_TIMEOUT_MS
    );

    let response: Response;
    try {
      response = await fetch(`${config.serverBaseUrl}${path}`, {
        headers: authorization ? { Authorization: authorization } : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`92hm 桥接请求失败: ${response.status}`);
    }

    return (await response.json()) as T;
  }

  async isEnabled(): Promise<boolean> {
    return (await getHm92Config()) !== null;
  }

  private mapListItem(item: Hm92ListItem): MangaSearchItem {
    return {
      id: String(item.id),
      sourceId: HM92_SOURCE_ID,
      sourceName: HM92_SOURCE_NAME,
      title: item.title || '未命名漫画',
      cover: buildHm92ImageProxyUrl(item.cover || ''),
    };
  }

  /** 与 Suwayomi 的 searchMangaSource 同口径：返回单个源的搜索结果列表。 */
  async searchMangaSource(
    keyword: string,
    page = 1
  ): Promise<MangaSearchItem[]> {
    const data = await this.request<Hm92ListResponse>(
      `/api/search?q=${encodeURIComponent(keyword)}&page=${page}`
    );
    return (data.results || []).map((item) => this.mapListItem(item));
  }

  /** 书库浏览：popular → 桥接排行（rank），latest → 桥接更新（update）。 */
  async browseManga(
    mode: 'popular' | 'latest' | 'completed' | 'ongoing',
    page = 1
  ): Promise<MangaRecommendResult> {
    const list = mode === 'latest' ? 'update' : 'rank';
    const data = await this.request<Hm92ListResponse>(
      `/api/browse?list=${list}&page=${page}`
    );
    return {
      hasNextPage: Boolean(data.hasNextPage),
      mangas: (data.results || []).map((item) => this.mapListItem(item)),
    };
  }

  async getMangaDetail(input: {
    mangaId: string;
    title?: string;
    cover?: string;
    sourceName?: string;
    description?: string;
    author?: string;
    status?: string;
  }): Promise<MangaDetail> {
    const book = await this.request<Hm92BookResponse>(
      `/api/book/${encodeURIComponent(input.mangaId)}`
    );

    // 桥接按正序（从第 1 话起）返回章节，与站内详情的章节列表口径一致；
    // 顺手按序号补上 chapterNumber，详情页的正序/倒序与“第一话”定位都靠它。
    const chapters: MangaChapter[] = (book.chapters || []).map(
      (chapter, index) => ({
        id: String(chapter.id),
        mangaId: String(book.id ?? input.mangaId),
        name: chapter.title || '未命名章节',
        chapterNumber: index + 1,
      })
    );

    return {
      id: String(book.id ?? input.mangaId),
      sourceId: HM92_SOURCE_ID,
      sourceName: input.sourceName || HM92_SOURCE_NAME,
      title: book.title || input.title || '漫画详情',
      cover: buildHm92ImageProxyUrl(book.cover || input.cover || ''),
      description: book.description || input.description,
      author: book.author || input.author,
      status:
        normalizeHm92Status(book.status) ||
        normalizeHm92Status(input.status),
      chapters,
    };
  }

  async getChapterPages(chapterId: string): Promise<string[]> {
    const data = await this.request<Hm92ChapterResponse>(
      `/api/chapter/${encodeURIComponent(chapterId)}`
    );
    return (data.pages || []).map((item) => buildHm92ImageProxyUrl(item));
  }
}

export const hm92Client = new Hm92Client();
