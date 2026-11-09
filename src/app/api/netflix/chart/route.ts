/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { searchTMDBMulti } from '@/lib/tmdb.client';

/** Netflix Top 10 官方公开数据：全球每周榜（TSV，每周二更新） */
const NETFLIX_TOP10_TSV = 'https://top10.netflix.com/data/all-weeks-global.tsv';

// 内存缓存对象（按电影/剧集分别缓存）
interface CacheItem {
  data: NetflixChartData;
  timestamp: number;
}

const cacheMap = new Map<string, CacheItem>();
const CACHE_DURATION = 60 * 60 * 1000; // 1小时（毫秒）

const TYPES = ['movie', 'tv'] as const;
type NetflixType = (typeof TYPES)[number];

/** TSV 里的分类：只取全球英文榜（电影 / 剧集） */
const CATEGORY: Record<NetflixType, string> = {
  movie: 'Films (English)',
  tv: 'TV (English)',
};

interface NetflixChartItem {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  media_type: 'movie' | 'tv';
  /** 本周观看时长（小时），Netflix 官方数据 */
  hours_viewed: number;
  /** 累计上榜周数 */
  weeks_in_top_10: number;
}

interface NetflixChartData {
  /** 榜单周（周日日期，如 2026-11-01） */
  week: string;
  items: NetflixChartItem[];
}

interface RawRow {
  rank: number;
  title: string;
  hoursViewed: number;
  weeksInTop10: number;
}

/**
 * 解析 Netflix Top 10 全球 TSV，取指定分类最新一周的前 10 名。
 * TSV 列：week / category / weekly_rank / show_title / season_title /
 * weekly_hours_viewed / runtime / weekly_views / cumulative_weeks_in_top_10
 * 文件按周倒序排列（最新一周在前）。
 */
function parseTop10Tsv(tsv: string, type: NetflixType): { week: string; rows: RawRow[] } | null {
  const lines = tsv.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const header = lines[0].split('\t');
  const col = {
    week: header.indexOf('week'),
    category: header.indexOf('category'),
    rank: header.indexOf('weekly_rank'),
    title: header.indexOf('show_title'),
    hours: header.indexOf('weekly_hours_viewed'),
    weeks: header.indexOf('cumulative_weeks_in_top_10'),
  };
  if (Object.values(col).some((i) => i < 0)) return null;

  const wantCategory = CATEGORY[type];
  let week = '';
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    if (cells[col.category] !== wantCategory) continue;
    if (!week) week = cells[col.week];
    // 只取最新一周；文件倒序，遇到更早的周即停
    if (cells[col.week] !== week) break;
    rows.push({
      rank: parseInt(cells[col.rank], 10) || 0,
      title: (cells[col.title] || '').trim(),
      hoursViewed: parseInt(cells[col.hours], 10) || 0,
      weeksInTop10: parseInt(cells[col.weeks], 10) || 0,
    });
  }
  if (!week || rows.length === 0) return null;
  rows.sort((a, b) => a.rank - b.rank);
  return { week, rows: rows.slice(0, 10) };
}

/**
 * 用 TMDB 搜片名补海报、评分、年份（尽力而为）。
 * 未配 TMDB Key 或搜不到时返回无海报的条目，榜单本身不受影响。
 */
async function enrichWithTmdb(
  rows: RawRow[],
  type: NetflixType
): Promise<NetflixChartItem[]> {
  const config = await getConfig();
  const apiKey = config.SiteConfig?.TMDBApiKey;

  const toItem = (
    row: RawRow,
    tmdb?: {
      id?: number;
      poster_path?: string | null;
      vote_average?: number;
      release_date?: string;
      first_air_date?: string;
    }
  ): NetflixChartItem => ({
    id: tmdb?.id ?? 0,
    title: row.title,
    poster_path: tmdb?.poster_path ?? null,
    release_date: tmdb?.release_date || tmdb?.first_air_date || '',
    overview: '',
    vote_average: tmdb?.vote_average ?? 0,
    media_type: type,
    hours_viewed: row.hoursViewed,
    weeks_in_top_10: row.weeksInTop10,
  });

  if (!apiKey) return rows.map((row) => toItem(row));

  return Promise.all(
    rows.map(async (row) => {
      try {
        const res = await searchTMDBMulti(apiKey, row.title);
        const results = (res.results || []).filter((r: any) => r?.poster_path);
        // 优先同类型（电影/剧集）的结果，其次任意带海报的结果
        const best =
          results.find((r: any) => r.media_type === type) || results[0];
        if (!best) return toItem(row);
        return toItem(row, best);
      } catch {
        return toItem(row);
      }
    })
  );
}

/**
 * Netflix Top 10 全球榜。
 * GET /api/netflix/chart?type=movie|tv
 * - movie：全球英文电影 Top 10（Films (English)）
 * - tv：全球英文剧集 Top 10（TV (English)）
 * 数据来源：Netflix Top 10 官方公开 TSV（https://top10.netflix.com/data/all-weeks-global.tsv），每周二更新。
 * 海报/评分/年份由 TMDB 搜索补齐（未配 Key 时留空，不影响榜单）。
 */
export async function GET(request: NextRequest) {
  try {
    const type = (request.nextUrl.searchParams.get('type') || 'movie') as NetflixType;
    if (!TYPES.includes(type)) {
      return NextResponse.json(
        { code: 400, message: 'type 参数必须是 movie 或 tv' },
        { status: 400 }
      );
    }

    const now = Date.now();
    const cached = cacheMap.get(type);
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        code: 200,
        data: cached.data,
        cached: true,
      });
    }

    const res = await fetch(NETFLIX_TOP10_TSV, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { code: 500, message: '获取 Netflix Top 10 数据失败' },
        { status: 500 }
      );
    }

    const parsed = parseTop10Tsv(await res.text(), type);
    if (!parsed) {
      return NextResponse.json(
        { code: 500, message: '解析 Netflix Top 10 数据失败' },
        { status: 500 }
      );
    }

    const items = await enrichWithTmdb(parsed.rows, type);
    const data: NetflixChartData = { week: parsed.week, items };
    cacheMap.set(type, { data, timestamp: now });

    return NextResponse.json({
      code: 200,
      data,
      cached: false,
    });
  } catch (error) {
    console.error('获取 Netflix Top 10 数据失败:', error);
    return NextResponse.json(
      { code: 500, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
