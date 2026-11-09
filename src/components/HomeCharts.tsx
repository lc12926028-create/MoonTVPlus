/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getDoubanCategories, getDoubanList } from '@/lib/douban.client';
import { getTMDBImageUrl, TMDBItem } from '@/lib/tmdb.client';
import { DoubanItem } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

/** 榜单行统一形状（TMDB / 豆瓣两路数据归一化后都长这样） */
interface ChartItem {
  key: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
  mediaType: 'movie' | 'tv';
}

interface ChartDef {
  id: string;
  label: string;
  /** 该榜的数据来源说明（展示在榜单下方，不假装是真 IMDb 数据） */
  sourceNote: string;
}

const CHARTS: ChartDef[] = [
  { id: 'imdb-week', label: 'IMDb 周榜', sourceNote: '数据来源：TMDB 本周热门（IMDb 暂无公开免费接口）' },
  { id: 'imdb-month', label: 'IMDb 月榜', sourceNote: '数据来源：TMDB 近 30 天上映热度（IMDb 暂无公开免费接口）' },
  { id: 'douban-week', label: '豆瓣周榜', sourceNote: '数据来源：豆瓣热门电影' },
  { id: 'douban-month', label: '豆瓣月榜', sourceNote: '数据来源：豆瓣高分电影' },
  { id: 'top250', label: 'Top250', sourceNote: '数据来源：豆瓣 Top250' },
  { id: 'us-box', label: '北美票房', sourceNote: '数据来源：TMDB 北美正在上映（票房榜暂无公开免费接口）' },
];

const FALLBACK_NOTE = '（TMDB 未配置或请求失败，已回退到豆瓣「欧美」热门）';

function tmdbToChartItem(item: TMDBItem): ChartItem {
  return {
    key: `tmdb-${item.media_type}-${item.id}`,
    title: item.title,
    poster: processImageUrl(getTMDBImageUrl(item.poster_path, 'w185')),
    rate: item.vote_average && item.vote_average > 0 ? item.vote_average.toFixed(1) : '',
    year: (item.release_date || '').split('-')[0] || '',
    mediaType: item.media_type === 'tv' ? 'tv' : 'movie',
  };
}

function doubanToChartItem(item: DoubanItem, prefix: string): ChartItem {
  return {
    key: `${prefix}-${item.id}`,
    title: item.title,
    poster: processImageUrl(item.poster),
    rate: item.rate || '',
    year: item.year || '',
    mediaType: 'movie',
  };
}

/**
 * 首页方案 A「榜单为王」：榜单切换栏 + 大数字名次排名列表 + 今日热门海报墙。
 * 信息密度最高，适合按榜找片。金色主题。
 */
export default function HomeCharts({
  hotMovies,
  loading: hotLoading,
}: {
  hotMovies: DoubanItem[];
  loading: boolean;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(CHARTS[0].id);
  // 每榜一缓存：切回来不再重复请求
  const [cache, setCache] = useState<Record<string, ChartItem[]>>({});
  const [fallbackNote, setFallbackNote] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchTmdbChart = useCallback(
    async (kind: 'week' | 'month' | 'us'): Promise<ChartItem[] | null> => {
      const res = await fetch(`/api/tmdb/chart?kind=${kind}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (json.code !== 200 || !Array.isArray(json.data) || json.data.length === 0) {
        return null;
      }
      return (json.data as TMDBItem[]).map(tmdbToChartItem);
    },
    []
  );

  const fetchDoubanOumei = useCallback(async (): Promise<ChartItem[]> => {
    const data = await getDoubanCategories({
      kind: 'movie',
      category: '欧美',
      type: '全部',
      pageLimit: 10,
    });
    return (data.list || []).map((item) => doubanToChartItem(item, 'oumei'));
  }, []);

  const loadChart = useCallback(
    async (id: string) => {
      if (cache[id]) return;
      setLoading(true);
      setError('');
      try {
        let items: ChartItem[] = [];
        let usedFallback = false;
        if (id === 'imdb-week' || id === 'imdb-month' || id === 'us-box') {
          const kind = id === 'imdb-week' ? 'week' : id === 'imdb-month' ? 'month' : 'us';
          const tmdbItems = await fetchTmdbChart(kind).catch(() => null);
          if (tmdbItems) {
            items = tmdbItems;
          } else {
            // TMDB 未配置或请求失败：回退到豆瓣「欧美」热门，并注明
            items = await fetchDoubanOumei();
            usedFallback = true;
          }
        } else if (id === 'douban-week') {
          const data = await getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
            pageLimit: 10,
          });
          items = (data.list || []).map((item) => doubanToChartItem(item, 'dw'));
        } else if (id === 'douban-month') {
          const data = await getDoubanCategories({
            kind: 'movie',
            category: '豆瓣高分',
            type: '全部',
            pageLimit: 10,
          });
          items = (data.list || []).map((item) => doubanToChartItem(item, 'dm'));
        } else if (id === 'top250') {
          const data = await getDoubanList({
            tag: 'top250',
            type: 'movie',
            pageLimit: 10,
          });
          items = (data.list || []).map((item) => doubanToChartItem(item, 't250'));
        }
        if (!mountedRef.current) return;
        setCache((prev) => ({ ...prev, [id]: items }));
        setFallbackNote((prev) => ({ ...prev, [id]: usedFallback }));
      } catch (err) {
        console.error('加载榜单失败:', err);
        if (mountedRef.current) setError('榜单加载失败，请稍后重试');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [cache, fetchTmdbChart, fetchDoubanOumei]
  );

  useEffect(() => {
    loadChart(activeId);
  }, [activeId, loadChart]);

  const activeChart = CHARTS.find((c) => c.id === activeId) || CHARTS[0];
  const items = cache[activeId] || [];

  const openItem = (item: ChartItem) => {
    const url = `/play?title=${encodeURIComponent(item.title.trim())}${
      item.year ? `&year=${item.year}` : ''
    }&stype=${item.mediaType}`;
    router.push(url);
  };

  return (
    <section aria-label='影视榜单' className='mb-8'>
      {/* 榜单切换栏 */}
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          影视榜单
        </h2>
        <Link
          href='/douban?type=movie'
          className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='w-4 h-4 ml-1' />
        </Link>
      </div>

      <div className='flex flex-wrap gap-1.5 mb-4'>
        {CHARTS.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveId(c.id)}
            className={
              c.id === activeId
                ? 'px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500 text-white shadow-sm'
                : 'px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 排名列表：大数字名次 1-10 */}
      {loading && items.length === 0 ? (
        <div className='space-y-2'>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className='flex items-center gap-3 py-2'>
              <div className='w-8 h-8 rounded bg-gray-200 dark:bg-gray-700 animate-pulse' />
              <div className='w-12 h-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse' />
              <div className='flex-1 space-y-2'>
                <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/3' />
                <div className='h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/4' />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className='text-center text-sm text-gray-400 py-8'>{error}</p>
      ) : items.length === 0 ? (
        <p className='text-center text-sm text-gray-400 py-8'>该榜单暂无数据</p>
      ) : (
        <ol className='divide-y divide-gray-100 dark:divide-gray-800'>
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                onClick={() => openItem(item)}
                className='w-full flex items-center gap-3 py-2.5 text-left group'
              >
                <span
                  className={
                    i < 3
                      ? 'w-8 shrink-0 text-center text-2xl font-black text-amber-500'
                      : 'w-8 shrink-0 text-center text-2xl font-black text-gray-300 dark:text-gray-600'
                  }
                >
                  {i + 1}
                </span>
                <span className='relative w-12 shrink-0 aspect-[2/3] rounded overflow-hidden bg-gray-200 dark:bg-gray-700'>
                  {item.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.poster}
                      alt={item.title}
                      loading='lazy'
                      className='w-full h-full object-cover'
                    />
                  ) : null}
                </span>
                <span className='flex-1 min-w-0'>
                  <span className='block truncate text-sm font-medium text-gray-800 group-hover:text-amber-600 dark:text-gray-200 dark:group-hover:text-amber-400'>
                    {item.title}
                  </span>
                  <span className='block text-xs text-gray-400 mt-0.5'>
                    {item.year || '年份未知'}
                    {item.mediaType === 'tv' ? ' · 剧集' : ' · 电影'}
                  </span>
                </span>
                {item.rate && (
                  <span className='shrink-0 text-sm font-semibold text-amber-500'>
                    ★ {item.rate}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* 数据来源说明 */}
      <p className='text-xs text-gray-400 mt-3'>
        {activeChart.sourceNote}
        {fallbackNote[activeId] ? FALLBACK_NOTE : ''}
      </p>

      {/* 今日热门海报墙 */}
      <div className='mt-8'>
        <div className='mb-4 flex items-center justify-between'>
          <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200'>
            今日热门
          </h3>
          <Link
            href='/douban?type=movie'
            className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          >
            查看更多
            <ChevronRight className='w-4 h-4 ml-1' />
          </Link>
        </div>
        <ScrollableRow>
          {hotLoading
            ? Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                >
                  <div className='aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                  <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4' />
                </div>
              ))
            : hotMovies.map((movie) => (
                <div
                  key={movie.id}
                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                >
                  <VideoCard
                    id={movie.id}
                    poster={movie.poster}
                    title={movie.title}
                    year={movie.year}
                    rate={movie.rate}
                    type='movie'
                    from='douban'
                    douban_id={movie.id ? parseInt(movie.id) : undefined}
                  />
                </div>
              ))}
        </ScrollableRow>
      </div>
    </section>
  );
}
