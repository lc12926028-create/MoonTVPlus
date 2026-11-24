/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    if (!query) {
      return NextResponse.json({ suggestions: [] });
    }

    // 生成建议
    const suggestions = await generateSuggestions(config, query, authInfo.username);

    // 从配置中获取缓存时间，如果没有配置则使用默认值300秒（5分钟）
    const cacheTime = config.SiteConfig.SiteInterfaceCacheTime || 300;

    return NextResponse.json(
      { suggestions },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  } catch (error) {
    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}

async function generateSuggestions(config: AdminConfig, query: string, username: string): Promise<
  Array<{
    text: string;
    title: string;
    type_name?: string;
    year?: string;
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();

  const apiSites = await getAvailableApiSites(username);
  if (apiSites.length === 0) {
    return [];
  }

  // 取第一个可用的数据源进行搜索，在其结果基础上提炼真实片名
  const firstSite = apiSites[0];
  const results = (await searchFromApi(firstSite, query)) as any[];

  // 按片名去重（不区分大小写），保留首次出现的类型 / 年份
  const byTitle = new Map<
    string,
    { title: string; type_name?: string; year?: string; score: number }
  >();

  for (const r of results) {
    if (
      !config.SiteConfig.DisableYellowFilter &&
      yellowWords.some((word: string) => (r.type_name || '').includes(word))
    ) {
      continue;
    }

    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) continue;

    const key = title.toLowerCase();
    if (byTitle.has(key)) continue;

    // 匹配度：完全匹配 > 前缀匹配 > 包含查询词 > 其余结果
    const titleLower = title.toLowerCase();
    let score = 1.0;
    if (titleLower === queryLower) {
      score = 4.0;
    } else if (titleLower.startsWith(queryLower)) {
      score = 3.0;
    } else if (titleLower.includes(queryLower)) {
      score = 2.0;
    }

    byTitle.set(key, {
      title,
      type_name: r.type_name || undefined,
      year: r.year ? String(r.year) : undefined,
      score,
    });
  }

  return Array.from(byTitle.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((item) => ({
      text: item.title, // 兼容旧字段：text 与 title 同为片名
      title: item.title,
      type_name: item.type_name,
      year: item.year,
      score: item.score,
    }));
}
