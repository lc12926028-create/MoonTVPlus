import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getTMDBChartContent } from '@/lib/tmdb.client';

// 内存缓存对象（按榜单种类分别缓存）
interface CacheItem {
  data: any;
  timestamp: number;
}

const cacheMap = new Map<string, CacheItem>();
const CACHE_DURATION = 60 * 60 * 1000; // 1小时（毫秒）

const KINDS = ['week', 'month', 'us'] as const;
type ChartKind = (typeof KINDS)[number];

/**
 * 首页榜单：TMDB 榜单数据。
 * GET /api/tmdb/chart?kind=week|month|us
 * - week：IMDb 周榜（TMDB 本周热门近似）
 * - month：IMDb 月榜（近 30 天上映热度近似）
 * - us：北美票房（北美正在上映近似）
 * 未配置 TMDB Key 时返回 400，前端回退到豆瓣「欧美」数据。
 */
export async function GET(request: NextRequest) {
  try {
    const kind = request.nextUrl.searchParams.get('kind') as ChartKind | null;
    if (!kind || !KINDS.includes(kind)) {
      return NextResponse.json(
        { code: 400, message: 'kind 参数必须是 week、month 或 us' },
        { status: 400 }
      );
    }

    const now = Date.now();
    const cached = cacheMap.get(kind);
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        code: 200,
        data: cached.data,
        cached: true,
      });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig?.TMDBApiKey;
    const tmdbProxy = config.SiteConfig?.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig?.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { code: 400, message: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    const result = await getTMDBChartContent(
      tmdbApiKey,
      kind,
      tmdbProxy,
      tmdbReverseProxy
    );

    if (result.code !== 200) {
      return NextResponse.json(
        { code: result.code, message: '获取TMDB榜单数据失败' },
        { status: result.code === 401 ? 401 : 500 }
      );
    }

    cacheMap.set(kind, { data: result.list, timestamp: now });

    return NextResponse.json({
      code: 200,
      data: result.list,
      cached: false,
    });
  } catch (error) {
    console.error('获取TMDB榜单数据失败:', error);
    return NextResponse.json(
      { code: 500, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
