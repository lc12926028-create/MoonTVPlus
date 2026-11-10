/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  B2_PRESIGNED_URL_EXPIRES_IN,
  createB2PresignedUrl,
  getB2Settings,
  prettifyB2Title,
} from '@/lib/server/b2';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ai-duanju/play-url?file=<B2 对象 key>
 * 仅站长（owner）可访问：为指定视频签发 S3 预签名播放链接（有效期 1 小时）。
 * 前端拿到链接后走现有 directplay 通道播放，视频流不经过本站 Worker。
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || authInfo.role !== 'owner') {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const file = request.nextUrl.searchParams.get('file') || '';
    if (!file || file.startsWith('/') || file.includes('..')) {
      return NextResponse.json({ error: '文件参数无效' }, { status: 400 });
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

    const url = await createB2PresignedUrl(settings, file);
    return NextResponse.json({
      url,
      file,
      title: prettifyB2Title(file),
      expiresIn: B2_PRESIGNED_URL_EXPIRES_IN,
    });
  } catch (error) {
    console.error('签发 AI 短剧播放链接失败:', error);
    return NextResponse.json(
      { error: (error as Error).message || '签发播放链接失败' },
      { status: 500 }
    );
  }
}
