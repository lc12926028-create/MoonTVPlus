import { NextRequest, NextResponse } from 'next/server';

import { HM92_SOURCE_ID, hm92Client } from '@/lib/hm92.client';
import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

type BrowseMode = 'popular' | 'latest' | 'completed' | 'ongoing';

// Suwayomi「92漫画」扩展的源 id：只有它支持下面这套筛选位
const MANHUA_92_SOURCE_ID = '1520913911854846698';

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

    // 92hm.top 桥接源只有热门（排行）/最新（更新）两个列表，分类筛选与进度模式不适用，
    // completed/ongoing 一律回落到热门，与前端只展示热门/最新页签保持一致。
    if (sourceId === HM92_SOURCE_ID) {
      const bridgeResult = await hm92Client.browseManga(mode, page);
      return NextResponse.json({
        results: bridgeResult.mangas,
        hasNextPage: bridgeResult.hasNextPage,
      });
    }

    // FILTER_POSITION 是 92漫画扩展专属的筛选位，其它 Suwayomi 源的筛选列表长度不一，
    // 带位下发会让服务端抛 ArrayIndexOutOfBounds。非 92 源改走源生 POPULAR/LATEST，
    // 已完结/连载中用返回结果的状态在本页内过滤（近似实现，分类下拉对这类源不生效）。
    if (sourceId !== MANHUA_92_SOURCE_ID) {
      const result = await suwayomiClient.getRecommendedManga(
        sourceId,
        mode === 'latest' ? 'LATEST' : 'POPULAR',
        page
      );
      let mangas = result.mangas;
      if (mode === 'completed') {
        mangas = mangas.filter((manga) => manga.status === '已完结');
      } else if (mode === 'ongoing') {
        mangas = mangas.filter((manga) => manga.status === '连载中');
      }
      return NextResponse.json({ results: mangas, hasNextPage: result.hasNextPage });
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
