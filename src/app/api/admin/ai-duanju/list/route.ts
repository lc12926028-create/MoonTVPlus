/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getB2Settings, listB2Videos } from '@/lib/server/b2';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ai-duanju/list
 * 仅站长（owner）可访问：列出 B2 桶 moontvplus-ai-duanju 内的 AI 短剧视频。
 * guest 与未登录用户返回 403；未配置 B2 密钥返回 400（code: B2_NOT_CONFIGURED）。
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || authInfo.role !== 'owner') {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const settings = await getB2Settings();
    if (!settings) {
      return NextResponse.json(
        {
          error:
            '未配置 B2 密钥，请先在管理后台「站点配置 → B2 AI 短剧」中填写 B2 Application Key',
          code: 'B2_NOT_CONFIGURED',
        },
        { status: 400 }
      );
    }

    const videos = await listB2Videos(settings);
    return NextResponse.json({ videos });
  } catch (error) {
    console.error('获取 AI 短剧列表失败:', error);
    return NextResponse.json(
      { error: (error as Error).message || '获取列表失败' },
      { status: 500 }
    );
  }
}
