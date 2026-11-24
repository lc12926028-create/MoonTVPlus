import { NextRequest, NextResponse } from 'next/server';

import {
  HM92_SOURCE_ID,
  HM92_SOURCE_NAME,
  hm92Client,
} from '@/lib/hm92.client';
import { MangaSearchItem } from '@/lib/manga.types';
import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const sourceId = searchParams.get('sourceId')?.trim() || undefined;
    const page = Number(searchParams.get('page') || '1');

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    // 指定 92hm.top 桥接源时只查桥接
    if (sourceId === HM92_SOURCE_ID) {
      const results = await hm92Client.searchMangaSource(q, page);
      return NextResponse.json({ results, failedSources: [] });
    }

    const result = await suwayomiClient.searchManga(q, sourceId, page);

    // 全部来源时把桥接结果并进来（追加在 Suwayomi 结果之后，失败只记 failedSources 不拖垮整页）
    if (!sourceId && (await hm92Client.isEnabled())) {
      try {
        const bridgeResults = await hm92Client.searchMangaSource(q, page);
        const seen = new Set(
          result.results.map((item) => `${item.sourceId}:${item.id}`)
        );
        const merged: MangaSearchItem[] = [...result.results];
        for (const item of bridgeResults) {
          const key = `${item.sourceId}:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(item);
        }
        result.results = merged;
      } catch (error) {
        result.failedSources = [
          ...(result.failedSources || []),
          {
            sourceId: HM92_SOURCE_ID,
            sourceName: HM92_SOURCE_NAME,
            error: error instanceof Error ? error.message : '未知错误',
          },
        ];
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

