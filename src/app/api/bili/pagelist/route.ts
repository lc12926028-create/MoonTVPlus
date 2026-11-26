import { NextRequest, NextResponse } from 'next/server';

import { BiliError, getBiliPageList } from '@/lib/bili';

export const runtime = 'nodejs';

/**
 * GET /api/bili/pagelist?bvid=<BV号>
 * 取一本有声书的章节列表（分P = 章节）。
 * 详情不要依赖 B 站 view 接口（不稳定，曾 412/404），只用搜索结果 + pagelist。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bvid = (searchParams.get('bvid') || '').trim();
  if (!bvid) {
    return NextResponse.json({ error: '缺少 bvid' }, { status: 400 });
  }
  try {
    const chapters = await getBiliPageList(bvid);
    return NextResponse.json({ code: 0, data: { bvid, chapters } });
  } catch (e) {
    if (e instanceof BiliError) {
      return NextResponse.json(
        { code: e.code, error: e.message, retryable: e.retryable },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { code: -1, error: '获取章节失败，请点一下重试', retryable: true },
      { status: 500 }
    );
  }
}
