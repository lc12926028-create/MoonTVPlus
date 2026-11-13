/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  ChevronDown,
  Clapperboard,
  Loader2,
  Play,
  ShieldAlert,
} from 'lucide-react';
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

interface AiDuanjuEpisode {
  video: AiDuanjuVideo;
  episode: number | null; // null = 无「第N集」标记（合集/单文件）
}

interface AiDuanjuGroup {
  name: string;
  episodes: AiDuanjuEpisode[];
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文数字（一 ~ 九十九）转阿拉伯数字，解析不了返回 null */
function parseChineseEpisodeNumber(text: string): number | null {
  const tenIndex = text.indexOf('十');
  if (tenIndex >= 0) {
    const tensPart = text.slice(0, tenIndex);
    const onesPart = text.slice(tenIndex + 1);
    const tens = tensPart === '' ? 1 : CHINESE_DIGITS[tensPart];
    const ones = onesPart === '' ? 0 : CHINESE_DIGITS[onesPart];
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }
  const value = CHINESE_DIGITS[text];
  return value === undefined ? null : value;
}

/**
 * 从展示标题解析剧名与集数：以结尾的「第N集」为切分标记，标记前是剧名，
 * N 支持阿拉伯数字与中文数字。没有该标记（合集单文件等）返回 episode=null。
 */
function parseAiDuanjuTitle(title: string): {
  series: string;
  episode: number | null;
} {
  const match = title
    .trim()
    .match(
      /^(.*?)[\s\-_·:：—、]*第\s*([0-9]+|[零一二三四五六七八九十]+)\s*集$/
    );
  if (!match) return { series: title, episode: null };

  let series = match[1].trim().replace(/[\s\-_·:：—、]+$/, '');
  if (series.startsWith('《') && series.endsWith('》')) {
    series = series.slice(1, -1).trim();
  }
  if (!series) return { series: title, episode: null };

  const rawNumber = match[2];
  const episode = /^[0-9]+$/.test(rawNumber)
    ? parseInt(rawNumber, 10)
    : parseChineseEpisodeNumber(rawNumber);
  if (episode === null || Number.isNaN(episode)) {
    return { series: title, episode: null };
  }
  return { series, episode };
}

/**
 * 按剧分组：同剧名的「第N集」归一组、集数升序；
 * 无集数标记的文件自成一组（不与任何剧合并，哪怕名字尾数相近）。
 * 组顺序按其在原列表（最近上传在前）中的首次出现位置。
 */
function groupAiDuanjuVideos(videos: AiDuanjuVideo[]): AiDuanjuGroup[] {
  const groups: AiDuanjuGroup[] = [];
  const bySeries = new Map<string, AiDuanjuGroup>();
  for (const video of videos) {
    const { series, episode } = parseAiDuanjuTitle(video.title);
    if (episode === null) {
      groups.push({ name: video.title, episodes: [{ video, episode: null }] });
      continue;
    }
    let group = bySeries.get(series);
    if (!group) {
      group = { name: series, episodes: [] };
      bySeries.set(series, group);
      groups.push(group);
    }
    group.episodes.push({ video, episode });
  }
  for (const group of groups) {
    group.episodes.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }
  return groups;
}

function AiDuanjuPageClient() {
  const [state, setState] = useState<PageState>('checking');
  const [videos, setVideos] = useState<AiDuanjuVideo[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

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

  const groups = groupAiDuanjuVideos(videos);

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
            {groups.map((group) => {
              // 只有一集（或合集单文件）：保持原卡片，一点即播，不套展开层
              if (group.episodes.length === 1) {
                const video = group.episodes[0].video;
                return (
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
                );
              }

              // 多集：剧卡片，显示剧名与集数，展开后逐集选播
              const totalSize = group.episodes.reduce(
                (sum, ep) => sum + ep.video.size,
                0
              );
              const latestModified = group.episodes.reduce(
                (latest, ep) =>
                  ep.video.lastModified > latest
                    ? ep.video.lastModified
                    : latest,
                ''
              );
              const expanded = expandedGroups.has(group.name);
              return (
                <div
                  key={`group-${group.name}`}
                  className='rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4 flex flex-col gap-3'
                >
                  <div className='flex items-start gap-3'>
                    <div className='w-12 h-12 shrink-0 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center'>
                      <Clapperboard className='w-6 h-6 text-green-600 dark:text-green-400' />
                    </div>
                    <div className='min-w-0'>
                      <h2 className='font-semibold text-gray-900 dark:text-gray-100 truncate'>
                        {group.name}
                      </h2>
                      <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                        共 {group.episodes.length} 集
                      </p>
                    </div>
                  </div>
                  <div className='text-xs text-gray-500 dark:text-gray-400 flex items-center gap-3'>
                    <span>{formatBytes(totalSize)}</span>
                    {latestModified && (
                      <span>{formatDate(latestModified)} 更新</span>
                    )}
                  </div>
                  <button
                    onClick={() => toggleGroup(group.name)}
                    className='mt-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors'
                  >
                    {expanded ? '收起选集' : '选集'}
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${
                        expanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {expanded && (
                    <div className='flex flex-wrap gap-2'>
                      {group.episodes.map((ep) => (
                        <button
                          key={ep.video.key}
                          onClick={() => handlePlay(ep.video)}
                          disabled={playingKey !== null}
                          className='inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-green-600/50 text-green-700 dark:text-green-400 text-sm hover:bg-green-50 dark:hover:bg-green-900/30 disabled:opacity-60 transition-colors'
                        >
                          {playingKey === ep.video.key ? (
                            <Loader2 className='w-3.5 h-3.5 animate-spin' />
                          ) : (
                            <Play className='w-3.5 h-3.5' />
                          )}
                          第{ep.episode}集
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
