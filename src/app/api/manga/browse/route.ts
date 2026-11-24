import { NextRequest, NextResponse } from 'next/server';

import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

type BrowseMode = 'popular' | 'latest' | 'completed' | 'ongoing';

// 92漫画源的筛选位置，与 Suwayomi 扩展的筛选定义一一对应。
// 客户端只传模式与分类序号，position 只在这里组装，不接受前端直传。
const FILTER_POSITION = {
  type: 1, // 按类型
  region: 2, // 按地区
  year: 5, // 按年份
  progress: 8, // 按进度：0 全部 / 1 已完结 / 2 连载中
  sort: 9, // 排序方式：2 按更新 / 4 按点击
} as const;

const SORT_BY_UPDATE = 2; // 按更新排序，与源生 LATEST 第一页顺序一致（已实测）
const SORT_BY_CLICKS = 4; // 按点击排序，与源生 POPULAR 第一页顺序一致（已实测）

function parseSelectState(value: string | null): number {
  const parsed = Number(value || '0');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId')?.trim();
    const page = Number(searchParams.get('page') || '1');
    const modeParam = searchParams.get('mode')?.trim().toLowerCase();
    const mode: BrowseMode =
      modeParam === 'latest' || modeParam === 'completed' || modeParam === 'ongoing'
        ? modeParam
        : 'popular';

    if (!sourceId) {
      return NextResponse.json({ results: [], hasNextPage: false });
    }

    const filters: Array<{ position: number; selectState: number }> = [];

    // 分类筛选：0 = 全部，不下发该条
    const type = parseSelectState(searchParams.get('type'));
    if (type > 0) {
      filters.push({ position: FILTER_POSITION.type, selectState: type });
    }
    const region = parseSelectState(searchParams.get('region'));
    if (region > 0) {
      filters.push({ position: FILTER_POSITION.region, selectState: region });
    }
    const year = parseSelectState(searchParams.get('year'));
    if (year > 0) {
      filters.push({ position: FILTER_POSITION.year, selectState: year });
    }

    // 进度与排序由模式决定
    if (mode === 'completed') {
      filters.push({ position: FILTER_POSITION.progress, selectState: 1 });
    } else if (mode === 'ongoing') {
      filters.push({ position: FILTER_POSITION.progress, selectState: 2 });
    }
    filters.push({
      position: FILTER_POSITION.sort,
      selectState: mode === 'latest' ? SORT_BY_UPDATE : SORT_BY_CLICKS,
    });

    const result = await suwayomiClient.browseSourceManga(sourceId, filters, page);
    return NextResponse.json({ results: result.mangas, hasNextPage: result.hasNextPage });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
