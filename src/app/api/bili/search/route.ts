import { NextRequest, NextResponse } from 'next/server';

import {
  BiliError,
  rankHotNovels,
  searchBiliAudio,
} from '@/lib/bili';

export const runtime = 'nodejs';

/**
 * GET /api/bili/search?q=<关键词>&page=<页>&order=<排序>
 * 搜 B 站有声书（只返回听书类内容，过滤规则见 src/lib/bili.ts）。
 * GET /api/bili/search?hot=1：热门推荐（有声小说按播放量排序）。
 *
 * B 站搜索偶尔会被风控（v_voucher）挡住：此时返回 retryable=true，
 * 前端展示“点一下重试”，不要把失败写死成“没有结果”。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    if (searchParams.get('hot') === '1') {
      const books = await rankHotNovels(30);
      return NextResponse.json({ code: 0, data: { books, total: books.length } });
    }

    const q = (searchParams.get('q') || '').trim();
    if (!q) {
      return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
    }
    const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
    const order = searchParams.get('order') || undefined;
    const data = await searchBiliAudio(q, page, 20, order);
    return NextResponse.json({ code: 0, data });
  } catch (e) {
    if (e instanceof BiliError) {
      const status = e.code === -412 ? 503 : 500;
      return NextResponse.json(
        { code: e.code, error: e.message, retryable: e.retryable },
        { status }
      );
    }
    return NextResponse.json(
      { code: -1, error: '搜索失败，请点一下重试', retryable: true },
      { status: 500 }
    );
  }
}
