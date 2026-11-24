import { NextRequest, NextResponse } from 'next/server';

import { HM92_SOURCE_ID, hm92Client } from '@/lib/hm92.client';
import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const chapterId = searchParams.get('chapterId')?.trim();
    if (!chapterId) {
      return NextResponse.json({ error: '缺少 chapterId' }, { status: 400 });
    }

    // 阅读页会把 sourceId 一起带过来：92hm.top 桥接源的章节 id 与 Suwayomi 的
    // 章节 id 不是同一套，必须按源分发；不带 sourceId 时保持原 Suwayomi 行为。
    const sourceId = searchParams.get('sourceId')?.trim();
    const pages =
      sourceId === HM92_SOURCE_ID
        ? await hm92Client.getChapterPages(chapterId)
        : await suwayomiClient.getChapterPages(chapterId);
    return NextResponse.json({ pages });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

