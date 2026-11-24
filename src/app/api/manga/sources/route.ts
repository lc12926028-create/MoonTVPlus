import { NextRequest, NextResponse } from 'next/server';

import { HM92_SOURCE_ENTRY, hm92Client } from '@/lib/hm92.client';
import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const lang = new URL(request.url).searchParams.get('lang') || process.env.SUWAYOMI_DEFAULT_LANG || 'zh';
    const sources = await suwayomiClient.getSources(lang);
    // 92hm.top 桥接源启用时，作为合成源追加到列表末尾（首页源页签、搜索页来源选择共用这份列表）
    if (await hm92Client.isEnabled()) {
      sources.push({ ...HM92_SOURCE_ENTRY });
    }
    return NextResponse.json({ sources });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

