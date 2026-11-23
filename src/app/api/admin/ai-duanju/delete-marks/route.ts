/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const MARKS_KEY = 'ai_duanju_delete_marks';

interface DeleteMarks {
  episodes: string[]; // B2 对象 key（单集）
  series: string[]; // 页面剧名分组名（整部）
  updatedAt: string;
}

const EMPTY_MARKS: DeleteMarks = { episodes: [], series: [], updatedAt: '' };

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  );
}

async function readMarks(): Promise<DeleteMarks> {
  const raw = await db.getGlobalValue(MARKS_KEY);
  if (!raw) return { ...EMPTY_MARKS };
  try {
    const parsed = JSON.parse(raw) as Partial<DeleteMarks>;
    return {
      episodes: sanitizeStringArray(parsed.episodes),
      series: sanitizeStringArray(parsed.series),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return { ...EMPTY_MARKS };
  }
}

async function writeMarks(marks: DeleteMarks): Promise<void> {
  await db.setGlobalValue(MARKS_KEY, JSON.stringify(marks));
}

/**
 * GET /api/admin/ai-duanju/delete-marks
 * 仅站长（owner）可访问：返回当前 AI 短剧删除标记
 * { episodes: B2 对象 key[], series: 剧名分组名[] }。
 * 本接口只登记/读取下架意向，不删除任何文件。
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || authInfo.role !== 'owner') {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const marks = await readMarks();
    return NextResponse.json({
      episodes: marks.episodes,
      series: marks.series,
    });
  } catch (error) {
    console.error('获取 AI 短剧删除标记失败:', error);
    return NextResponse.json(
      { error: (error as Error).message || '获取删除标记失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/ai-duanju/delete-marks
 * 仅站长（owner）可访问：body { type: 'episode' | 'series', target, marked }。
 * marked=true 加入标记、false 取消标记；返回更新后的全量 { episodes, series }。
 * 本接口只登记下架意向，不删除任何文件。
 */
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || authInfo.role !== 'owner') {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      type?: unknown;
      target?: unknown;
      marked?: unknown;
    } | null;
    if (
      !body ||
      (body.type !== 'episode' && body.type !== 'series') ||
      typeof body.target !== 'string' ||
      body.target.length === 0 ||
      typeof body.marked !== 'boolean'
    ) {
      return NextResponse.json({ error: '参数非法' }, { status: 400 });
    }

    const marks = await readMarks();
    const current =
      body.type === 'episode' ? marks.episodes : marks.series;
    const nextSet = new Set<string>(current);
    if (body.marked) {
      nextSet.add(body.target);
    } else {
      nextSet.delete(body.target);
    }
    const nextList = Array.from(nextSet);
    if (body.type === 'episode') {
      marks.episodes = nextList;
    } else {
      marks.series = nextList;
    }
    marks.updatedAt = new Date().toISOString();
    await writeMarks(marks);

    return NextResponse.json({
      episodes: marks.episodes,
      series: marks.series,
    });
  } catch (error) {
    console.error('保存 AI 短剧删除标记失败:', error);
    return NextResponse.json(
      { error: (error as Error).message || '保存删除标记失败' },
      { status: 500 }
    );
  }
}
