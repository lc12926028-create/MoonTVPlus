/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Clapperboard, Loader2, Play, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { base58Encode } from '@/lib/utils';

import PageLayout from '@/components/PageLayout';

interface AiDuanjuVideo {
  key: string;
  title: string;
  size: number;
  lastModified: string;
}

type PageState =
  | 'checking'
  | 'loading'
  | 'forbidden'
  | 'not-configured'
  | 'error'
  | 'empty'
  | 'ready';

function formatBytes(bytes: number): string {
  if (!bytes) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function AiDuanjuPageClient() {
  const [state, setState] = useState<PageState>('checking');
  const [videos, setVideos] = useState<AiDuanjuVideo[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  useEffect(() => {
    // 前端第一道门：非站长直接显示无权限，不请求列表接口。
    // 真正的鉴权在服务端接口（/api/admin/ai-duanju/*，仅 owner 返回 200）。
    const authInfo = getAuthInfoFromBrowserCookie();
    if (!authInfo || authInfo.role !== 'owner') {
      setState('forbidden');
      return;
    }

    const loadVideos = async () => {
      setState('loading');
      try {
        const response = await fetch('/api/admin/ai-duanju/list');
        const result = await response.json().catch(() => ({}));
        if (response.status === 403) {
          setState('forbidden');
          return;
        }
        if (result.code === 'B2_NOT_CONFIGURED') {
          setState('not-configured');
          return;
        }
        if (!response.ok) {
          throw new Error(result.error || '获取列表失败');
        }
        const list = (result.videos || []) as AiDuanjuVideo[];
        setVideos(list);
        setState(list.length === 0 ? 'empty' : 'ready');
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : '获取列表失败'
        );
        setState('error');
      }
    };

    loadVideos();
  }, []);

  const handlePlay = async (video: AiDuanjuVideo) => {
    if (playingKey) return;
    setPlayingKey(video.key);
    try {
      const response = await fetch(
        `/api/admin/ai-duanju/play-url?file=${encodeURIComponent(video.key)}`
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || '获取播放链接失败');
      }
      const encoded = base58Encode(result.url as string);
      if (!encoded) {
        throw new Error('播放链接编码失败');
      }
      // 复用现有 directplay 通道：播放页直接播预签名直链（1 小时有效）
      window.location.assign(
        `/play?source=directplay&id=${encodeURIComponent(
          encoded
        )}&title=${encodeURIComponent(video.title)}`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : '获取播放链接失败'
      );
      setState('error');
      setPlayingKey(null);
    }
  };

  return (
    <PageLayout activePath='/ai-duanju'>
      <div className='px-4 md:px-8 py-6 max-w-6xl mx-auto'>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
            <Clapperboard className='w-6 h-6 text-green-600' />
            AI 短剧
          </h1>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            仅站长可见 · 片源来自 Backblaze B2 私有桶
          </p>
        </div>

        {(state === 'checking' || state === 'loading') && (
          <div className='flex flex-col items-center justify-center py-24 text-gray-500 dark:text-gray-400'>
            <Loader2 className='w-8 h-8 animate-spin mb-3' />
            <p className='text-sm'>正在加载 AI 短剧列表...</p>
          </div>
        )}

        {state === 'forbidden' && (
          <div className='flex flex-col items-center justify-center py-24 text-center'>
            <ShieldAlert className='w-10 h-10 text-red-500 mb-3' />
            <p className='text-base font-medium text-gray-900 dark:text-gray-100'>
              无权限访问
            </p>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              AI 短剧仅站长可见
            </p>
            <Link
              href='/'
              className='mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 transition-colors'
            >
              返回首页
            </Link>
          </div>
        )}

        {state === 'not-configured' && (
          <div className='flex flex-col items-center justify-center py-24 text-center'>
            <ShieldAlert className='w-10 h-10 text-amber-500 mb-3' />
            <p className='text-base font-medium text-gray-900 dark:text-gray-100'>
              还没配置 B2 密钥
            </p>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              请先在管理后台「站点配置 → B2 AI 短剧」中填写 B2 Application
              Key，保存后点「重载配置」
            </p>
            <Link
              href='/admin'
              className='mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 transition-colors'
            >
              去管理后台配置
            </Link>
          </div>
        )}

        {state === 'error' && (
          <div className='flex flex-col items-center justify-center py-24 text-center'>
            <p className='text-base font-medium text-gray-900 dark:text-gray-100'>
              加载失败
            </p>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              {errorMessage}
            </p>
            <button
              onClick={() => window.location.reload()}
              className='mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 transition-colors'
            >
              重新加载
            </button>
          </div>
        )}

        {state === 'empty' && (
          <div className='flex flex-col items-center justify-center py-24 text-center'>
            <Clapperboard className='w-10 h-10 text-gray-400 mb-3' />
            <p className='text-base font-medium text-gray-900 dark:text-gray-100'>
              桶里还没有视频
            </p>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              把短剧传到 B2 桶 moontvplus-ai-duanju 后再来
            </p>
          </div>
        )}

        {state === 'ready' && (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
            {videos.map((video) => (
              <div
                key={video.key}
                className='rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4 flex flex-col gap-3'
              >
                <div className='flex items-start gap-3'>
                  <div className='w-12 h-12 shrink-0 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center'>
                    <Clapperboard className='w-6 h-6 text-green-600 dark:text-green-400' />
                  </div>
                  <div className='min-w-0'>
                    <h2 className='font-semibold text-gray-900 dark:text-gray-100 truncate'>
                      {video.title}
                    </h2>
                    <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                      {video.key}
                    </p>
                  </div>
                </div>
                <div className='text-xs text-gray-500 dark:text-gray-400 flex items-center gap-3'>
                  <span>{formatBytes(video.size)}</span>
                  {video.lastModified && (
                    <span>{formatDate(video.lastModified)} 上传</span>
                  )}
                </div>
                <button
                  onClick={() => handlePlay(video)}
                  disabled={playingKey !== null}
                  className='mt-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60 transition-colors'
                >
                  {playingKey === video.key ? (
                    <Loader2 className='w-4 h-4 animate-spin' />
                  ) : (
                    <Play className='w-4 h-4' />
                  )}
                  {playingKey === video.key ? '正在准备播放...' : '播放'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function AiDuanjuPage() {
  return (
    <Suspense
      fallback={
        <div className='flex items-center justify-center py-24'>
          <Loader2 className='w-8 h-8 animate-spin text-gray-400' />
        </div>
      }
    >
      <AiDuanjuPageClient />
    </Suspense>
  );
}
