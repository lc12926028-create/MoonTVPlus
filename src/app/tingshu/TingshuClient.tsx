/* 听书区客户端：搜索 + 分类 + 章节列表 + B 站官方播放器 + 书架收藏。
 *
 * 播放用 B 站官方 iframe 播放器（player.bilibili.com），内容来自 B 站公开视频，
 * 不下载、不存音频。书架与“继续收听”只存浏览器本地（localStorage）。
 * 分类与筛选规则参考开源项目 fengqiao57/abts（MIT 协议）。
 */
'use client';

import {
  Bookmark,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  Play,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface BiliBook {
  bvid: string;
  aid: number;
  title: string;
  pic: string;
  duration: number;
  durationText: string;
  author: string;
  mid: number;
  play: number;
  pubdate: number;
  desc: string;
}

interface BiliChapter {
  page: number;
  cid: number;
  part: string;
  duration: number;
}

interface ShelfItem {
  bvid: string;
  title: string;
  pic: string;
  author: string;
  durationText: string;
  savedAt: number;
  lastPage?: number;
  lastPart?: string;
}

interface LastPlay {
  bvid: string;
  title: string;
  pic: string;
  author: string;
  page: number;
  cid: number;
  part: string;
  at: number;
}

const SHELF_KEY = 'tingshu-bookshelf-v1';
const LAST_PLAY_KEY = 'tingshu-last-play-v1';

// 分类（词表来自 abts）：点一下就按这个词搜
const CATEGORIES: { label: string; q: string; order?: string }[] = [
  { label: '热门推荐', q: '有声小说', order: 'click' },
  { label: '广播剧', q: '广播剧' },
  { label: '评书', q: '评书' },
  { label: '相声', q: '相声' },
  { label: '悬疑', q: '悬疑有声小说' },
  { label: '玄幻仙侠', q: '玄幻有声小说' },
  { label: '名著悦读', q: '名著有声小说' },
];

// 精选主播（名单来自 abts）
const NARRATORS = [
  '单田芳',
  '刘兰芳',
  '郭德纲',
  '周建龙',
  '紫襟',
  '王明军',
  '光合积木',
  '729声工场',
];

function formatPlay(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

function formatChapterDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json()) as {
    code?: number;
    data?: T;
    error?: string;
    retryable?: boolean;
  };
  if (!res.ok || data.code !== 0) {
    const err = new Error(data.error || '请求失败，请点一下重试') as Error & {
      retryable?: boolean;
    };
    err.retryable = data.retryable !== false;
    throw err;
  }
  return data.data as T;
}

function loadShelf(): ShelfItem[] {
  try {
    return JSON.parse(localStorage.getItem(SHELF_KEY) || '[]') as ShelfItem[];
  } catch {
    return [];
  }
}

function loadLastPlay(): LastPlay | null {
  try {
    const raw = localStorage.getItem(LAST_PLAY_KEY);
    return raw ? (JSON.parse(raw) as LastPlay) : null;
  } catch {
    return null;
  }
}

export default function TingshuClient() {
  const [tab, setTab] = useState<'home' | 'shelf'>('home');
  const [view, setView] = useState<'home' | 'results' | 'book'>('home');
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [lastOrder, setLastOrder] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<BiliBook[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [hot, setHot] = useState<BiliBook[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotError, setHotError] = useState(false);

  const [book, setBook] = useState<BiliBook | null>(null);
  const [chapters, setChapters] = useState<BiliChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState<string | null>(null);

  const [playing, setPlaying] = useState<{
    bvid: string;
    cid: number;
    page: number;
    part: string;
  } | null>(null);

  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [lastPlay, setLastPlay] = useState<LastPlay | null>(null);

  useEffect(() => {
    setShelf(loadShelf());
    setLastPlay(loadLastPlay());
  }, []);

  const loadHot = useCallback(async () => {
    setHotLoading(true);
    setHotError(false);
    try {
      const data = await apiGet<{ books: BiliBook[] }>('/api/bili/search?hot=1');
      setHot(data.books || []);
    } catch {
      setHotError(true);
    } finally {
      setHotLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHot();
  }, [loadHot]);

  const doSearch = useCallback(
    async (q: string, p: number, order?: string, append = false) => {
      const keyword = q.trim();
      if (!keyword) return;
      setSearching(true);
      setSearchError(null);
      if (!append) {
        setResults([]);
        setPage(1);
      }
      try {
        const data = await apiGet<{ books: BiliBook[]; total: number }>(
          `/api/bili/search?q=${encodeURIComponent(keyword)}&page=${p}` +
            (order ? `&order=${order}` : '')
        );
        setResults((prev) => (append ? [...prev, ...data.books] : data.books));
        setTotal(data.total || 0);
        setHasMore(data.books.length >= 20);
        setPage(p);
        setLastQuery(keyword);
        setLastOrder(order);
        setView('results');
        setTab('home');
      } catch (e) {
        setSearchError((e as Error).message || '搜索失败，请点一下重试');
      } finally {
        setSearching(false);
      }
    },
    []
  );

  const openBook = useCallback(async (b: BiliBook) => {
    setBook(b);
    setChapters([]);
    setChaptersError(null);
    setPlaying(null);
    setView('book');
    setChaptersLoading(true);
    try {
      const data = await apiGet<{ chapters: BiliChapter[] }>(
        `/api/bili/pagelist?bvid=${b.bvid}`
      );
      setChapters(data.chapters || []);
    } catch (e) {
      setChaptersError((e as Error).message || '获取章节失败，请点一下重试');
    } finally {
      setChaptersLoading(false);
    }
  }, []);

  const saveShelf = (next: ShelfItem[]) => {
    setShelf(next);
    try {
      localStorage.setItem(SHELF_KEY, JSON.stringify(next));
    } catch {
      // 本地存不下时静默失败，不影响收听
    }
  };

  const isInShelf = (bvid: string) => shelf.some((s) => s.bvid === bvid);

  const toggleShelf = (b: BiliBook) => {
    if (isInShelf(b.bvid)) {
      saveShelf(shelf.filter((s) => s.bvid !== b.bvid));
    } else {
      saveShelf([
        {
          bvid: b.bvid,
          title: b.title,
          pic: b.pic,
          author: b.author,
          durationText: b.durationText,
          savedAt: Date.now(),
        },
        ...shelf,
      ]);
    }
  };

  const removeFromShelf = (bvid: string) => {
    saveShelf(shelf.filter((s) => s.bvid !== bvid));
  };

  const playChapter = (ch: BiliChapter) => {
    if (!book) return;
    setPlaying({ bvid: book.bvid, cid: ch.cid, page: ch.page, part: ch.part });
    const lp: LastPlay = {
      bvid: book.bvid,
      title: book.title,
      pic: book.pic,
      author: book.author,
      page: ch.page,
      cid: ch.cid,
      part: ch.part,
      at: Date.now(),
    };
    setLastPlay(lp);
    try {
      localStorage.setItem(LAST_PLAY_KEY, JSON.stringify(lp));
    } catch {
      // 忽略
    }
    // 同步书架里的上次听到哪一章
    if (isInShelf(book.bvid)) {
      saveShelf(
        shelf.map((s) =>
          s.bvid === book.bvid
            ? { ...s, lastPage: ch.page, lastPart: ch.part }
            : s
        )
      );
    }
  };

  const playAdjacent = (dir: 1 | -1) => {
    if (!playing || chapters.length === 0) return;
    const idx = chapters.findIndex((c) => c.page === playing.page);
    const next = chapters[idx + dir];
    if (next) playChapter(next);
  };

  const resumeLastPlay = () => {
    if (!lastPlay) return;
    // 先在当前结果/热门里找这本书，找不到就按 bvid 直接进详情（用保存的信息拼一本）
    const found =
      results.find((b) => b.bvid === lastPlay.bvid) ||
      hot.find((b) => b.bvid === lastPlay.bvid);
    if (found) {
      openBook(found).then(() => {
        setPlaying({
          bvid: lastPlay.bvid,
          cid: lastPlay.cid,
          page: lastPlay.page,
          part: lastPlay.part,
        });
      });
    } else {
      setBook({
        bvid: lastPlay.bvid,
        aid: 0,
        title: lastPlay.title,
        pic: lastPlay.pic,
        duration: 0,
        durationText: '',
        author: lastPlay.author,
        mid: 0,
        play: 0,
        pubdate: 0,
        desc: '',
      });
      setChapters([]);
      setChaptersError(null);
      setView('book');
      setChaptersLoading(true);
      apiGet<{ chapters: BiliChapter[] }>(
        `/api/bili/pagelist?bvid=${lastPlay.bvid}`
      )
        .then((data) => {
          setChapters(data.chapters || []);
          setPlaying({
            bvid: lastPlay.bvid,
            cid: lastPlay.cid,
            page: lastPlay.page,
            part: lastPlay.part,
          });
        })
        .catch((e) => {
          setChaptersError((e as Error).message || '获取章节失败，请点一下重试');
        })
        .finally(() => setChaptersLoading(false));
    }
  };

  const backHome = () => {
    setView('home');
    setTab('home');
    setBook(null);
    setPlaying(null);
  };

  const playerSrc = playing
    ? `https://player.bilibili.com/player.html?bvid=${playing.bvid}&cid=${playing.cid}&page=${playing.page}&high_quality=1&danmaku=0&autoplay=1`
    : '';

  return (
    <div className='mx-auto max-w-6xl px-3 pb-16 pt-4 sm:px-6'>
      {/* 头部 */}
      <div className='mb-4 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          {view !== 'home' && (
            <button
              onClick={backHome}
              className='rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              title='返回'
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <Headphones size={22} className='text-purple-500' />
          <h1 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
            听书
          </h1>
        </div>
        <div className='flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800'>
          <button
            onClick={() => {
              setTab('home');
              setView('home');
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === 'home'
                ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            发现
          </button>
          <button
            onClick={() => {
              setTab('shelf');
              setView('home');
            }}
            className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm ${
              tab === 'shelf'
                ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <BookMarked size={14} />
            书架（{shelf.length}）
          </button>
        </div>
      </div>

      {view === 'home' && tab === 'home' && (
        <>
          {/* 搜索框 */}
          <div className='mb-4 flex gap-2'>
            <div className='relative flex-1'>
              <Search
                size={18}
                className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400'
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSearch(query, 1);
                }}
                placeholder='搜有声书、评书、相声、主播…'
                className='w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400'
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              onClick={() => doSearch(query, 1)}
              disabled={searching || !query.trim()}
              className='rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50'
            >
              {searching ? '搜索中…' : '搜索'}
            </button>
          </div>

          {/* 分类 */}
          <div className='mb-3 flex flex-wrap gap-2'>
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                onClick={() => {
                  setQuery(c.q);
                  doSearch(c.q, 1, c.order);
                }}
                className='rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-purple-500 hover:text-purple-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-purple-400'
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* 精选主播 */}
          <div className='mb-6'>
            <div className='mb-2 text-sm font-medium text-gray-500 dark:text-gray-400'>
              精选主播
            </div>
            <div className='flex flex-wrap gap-2'>
              {NARRATORS.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setQuery(n);
                    doSearch(n, 1);
                  }}
                  className='flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-purple-100 hover:text-purple-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-purple-900/40'
                >
                  <User size={13} />
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* 继续收听 */}
          {lastPlay && (
            <div className='mb-6 flex items-center gap-3 rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-900 dark:bg-purple-950/40'>
              {lastPlay.pic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lastPlay.pic}
                  alt=''
                  className='h-14 w-11 shrink-0 rounded object-cover'
                />
              ) : (
                <div className='flex h-14 w-11 shrink-0 items-center justify-center rounded bg-purple-200 dark:bg-purple-900'>
                  <Headphones size={18} className='text-purple-600' />
                </div>
              )}
              <div className='min-w-0 flex-1'>
                <div className='text-xs text-purple-600 dark:text-purple-300'>
                  继续收听
                </div>
                <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                  {lastPlay.title}
                </div>
                <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                  第 {lastPlay.page} 章 · {lastPlay.part}
                </div>
              </div>
              <button
                onClick={resumeLastPlay}
                className='flex shrink-0 items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700'
              >
                <Play size={14} />
                继续听
              </button>
            </div>
          )}

          {/* 热门推荐 */}
          <div className='mb-2 flex items-center justify-between'>
            <h2 className='text-base font-bold text-gray-900 dark:text-gray-100'>
              热门推荐
            </h2>
            {hotError && (
              <button
                onClick={loadHot}
                className='flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700'
              >
                <RotateCcw size={14} />
                点一下重试
              </button>
            )}
          </div>
          {hotLoading && hot.length === 0 && (
            <div className='py-8 text-center text-sm text-gray-400'>
              正在加载热门有声书…
            </div>
          )}
          {hotError && hot.length === 0 && (
            <div className='rounded-lg border border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              热门推荐暂时拉不到，B 站那边偶尔会验证繁忙。
              <button
                onClick={loadHot}
                className='ml-2 text-purple-600 hover:text-purple-700'
              >
                点一下重试
              </button>
            </div>
          )}
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
            {hot.map((b) => (
              <BookCard key={b.bvid} book={b} onOpen={openBook} />
            ))}
          </div>
        </>
      )}

      {view === 'home' && tab === 'shelf' && (
        <>
          <h2 className='mb-3 text-base font-bold text-gray-900 dark:text-gray-100'>
            我的书架
          </h2>
          {shelf.length === 0 ? (
            <div className='rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              书架还是空的。在书详情页点“收藏到书架”，喜欢的有声书就留在这里。
            </div>
          ) : (
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
              {shelf.map((s) => (
                <div
                  key={s.bvid}
                  className='group relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                >
                  <button
                    onClick={() =>
                      openBook({
                        bvid: s.bvid,
                        aid: 0,
                        title: s.title,
                        pic: s.pic,
                        duration: 0,
                        durationText: s.durationText,
                        author: s.author,
                        mid: 0,
                        play: 0,
                        pubdate: 0,
                        desc: '',
                      })
                    }
                    className='block w-full text-left'
                  >
                    {s.pic ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.pic}
                        alt={s.title}
                        className='aspect-video w-full object-cover'
                      />
                    ) : (
                      <div className='flex aspect-video w-full items-center justify-center bg-gray-100 dark:bg-gray-700'>
                        <Headphones size={24} className='text-gray-400' />
                      </div>
                    )}
                    <div className='p-2'>
                      <div className='line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {s.title}
                      </div>
                      <div className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'>
                        {s.author}
                        {s.durationText ? ` · ${s.durationText}` : ''}
                      </div>
                      {s.lastPage ? (
                        <div className='mt-1 text-xs text-purple-600 dark:text-purple-300'>
                          听到第 {s.lastPage} 章
                          {s.lastPart ? ` · ${s.lastPart}` : ''}
                        </div>
                      ) : null}
                    </div>
                  </button>
                  <button
                    onClick={() => removeFromShelf(s.bvid)}
                    className='absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80'
                    title='移出书架'
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'results' && (
        <>
          <div className='mb-3 flex items-center justify-between'>
            <h2 className='text-base font-bold text-gray-900 dark:text-gray-100'>
              “{lastQuery}” 的搜索结果
              {total > 0 && (
                <span className='ml-2 text-sm font-normal text-gray-500'>
                  约 {total} 条
                </span>
              )}
            </h2>
            <button
              onClick={backHome}
              className='text-sm text-purple-600 hover:text-purple-700'
            >
              返回发现
            </button>
          </div>
          {searchError && (
            <div className='mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'>
              {searchError}
              <button
                onClick={() => doSearch(lastQuery, 1, lastOrder)}
                className='ml-2 inline-flex items-center gap-1 font-medium text-purple-600 hover:text-purple-700'
              >
                <RotateCcw size={14} />
                点一下重试
              </button>
            </div>
          )}
          {searching && results.length === 0 && !searchError && (
            <div className='py-8 text-center text-sm text-gray-400'>
              正在搜索…
            </div>
          )}
          {!searching && !searchError && results.length === 0 && (
            <div className='rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              没找到相关的有声书，换个词试试。
            </div>
          )}
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
            {results.map((b) => (
              <BookCard key={b.bvid} book={b} onOpen={openBook} />
            ))}
          </div>
          {hasMore && !searching && (
            <div className='mt-6 text-center'>
              <button
                onClick={() => doSearch(lastQuery, page + 1, lastOrder, true)}
                className='rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-700 hover:border-purple-500 hover:text-purple-600 dark:border-gray-700 dark:text-gray-200'
              >
                加载更多
              </button>
            </div>
          )}
        </>
      )}

      {view === 'book' && book && (
        <>
          {/* 播放器 */}
          {playing && (
            <div className='mb-4'>
              <div className='overflow-hidden rounded-xl bg-black'>
                <iframe
                  key={`${playing.bvid}-${playing.cid}`}
                  src={playerSrc}
                  className='aspect-video w-full'
                  allow='autoplay; fullscreen'
                  allowFullScreen
                  title={playing.part || book.title}
                />
              </div>
              <div className='mt-2 flex items-center justify-between gap-2'>
                <button
                  onClick={() => playAdjacent(-1)}
                  disabled={
                    chapters.findIndex((c) => c.page === playing.page) <= 0
                  }
                  className='flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-purple-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200'
                >
                  <ChevronLeft size={16} />
                  上一章
                </button>
                <div className='min-w-0 flex-1 truncate text-center text-sm text-gray-600 dark:text-gray-300'>
                  正在播：第 {playing.page} 章 · {playing.part}
                </div>
                <button
                  onClick={() => playAdjacent(1)}
                  disabled={
                    chapters.findIndex((c) => c.page === playing.page) >=
                    chapters.length - 1
                  }
                  className='flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-purple-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200'
                >
                  下一章
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className='mt-1 text-center text-xs text-gray-400'>
                在 B 站官方播放器中播放；播完一章请点“下一章”
              </div>
            </div>
          )}

          {/* 书信息 */}
          <div className='mb-4 flex gap-3'>
            {book.pic ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={book.pic}
                alt={book.title}
                className='h-28 w-20 shrink-0 rounded-lg object-cover'
              />
            ) : (
              <div className='flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700'>
                <Headphones size={24} className='text-gray-400' />
              </div>
            )}
            <div className='min-w-0 flex-1'>
              <h2 className='text-lg font-bold leading-snug text-gray-900 dark:text-gray-100'>
                {book.title}
              </h2>
              <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400'>
                {book.author && (
                  <span className='flex items-center gap-1'>
                    <User size={13} />
                    {book.author}
                  </span>
                )}
                {book.durationText && (
                  <span className='flex items-center gap-1'>
                    <Clock size={13} />
                    总时长 {book.durationText}
                  </span>
                )}
                {book.play > 0 && <span>播放 {formatPlay(book.play)}</span>}
              </div>
              {book.desc && (
                <p className='mt-2 line-clamp-3 text-sm text-gray-600 dark:text-gray-300'>
                  {book.desc}
                </p>
              )}
              <div className='mt-3 flex gap-2'>
                <button
                  onClick={() => toggleShelf(book)}
                  className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm ${
                    isInShelf(book.bvid)
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200'
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  }`}
                >
                  <Bookmark
                    size={15}
                    fill={isInShelf(book.bvid) ? 'currentColor' : 'none'}
                  />
                  {isInShelf(book.bvid) ? '已在书架' : '收藏到书架'}
                </button>
                {chapters.length > 0 && !playing && (
                  <button
                    onClick={() => {
                      const shelfItem = shelf.find(
                        (s) => s.bvid === book.bvid
                      );
                      const target =
                        (shelfItem?.lastPage
                          ? chapters.find(
                              (c) => c.page === shelfItem.lastPage
                            )
                          : undefined) || chapters[0];
                      playChapter(target);
                    }}
                    className='flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-purple-500 dark:border-gray-700 dark:text-gray-200'
                  >
                    <Play size={15} />
                    {shelf.find((s) => s.bvid === book.bvid)?.lastPage
                      ? '继续收听'
                      : '从第 1 章开始听'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 章节列表 */}
          <h3 className='mb-2 text-base font-bold text-gray-900 dark:text-gray-100'>
            章节
            {chapters.length > 0 && (
              <span className='ml-2 text-sm font-normal text-gray-500'>
                共 {chapters.length} 章
              </span>
            )}
          </h3>
          {chaptersLoading && (
            <div className='py-6 text-center text-sm text-gray-400'>
              正在加载章节…
            </div>
          )}
          {chaptersError && (
            <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'>
              {chaptersError}
              <button
                onClick={() => openBook(book)}
                className='ml-2 inline-flex items-center gap-1 font-medium text-purple-600 hover:text-purple-700'
              >
                <RotateCcw size={14} />
                点一下重试
              </button>
            </div>
          )}
          {!chaptersLoading && !chaptersError && chapters.length === 0 && (
            <div className='rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              这本书暂时没有章节信息。
            </div>
          )}
          <div className='divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700'>
            {chapters.map((ch) => {
              const isPlaying = playing?.cid === ch.cid;
              const isLast =
                shelf.find((s) => s.bvid === book.bvid)?.lastPage === ch.page;
              return (
                <button
                  key={ch.cid}
                  onClick={() => playChapter(ch)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    isPlaying ? 'bg-purple-50 dark:bg-purple-950/40' : ''
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
                      isPlaying
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {ch.page}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100'>
                    {ch.part || `第 ${ch.page} 章`}
                  </span>
                  {isLast && !isPlaying && (
                    <span className='shrink-0 text-xs text-purple-600 dark:text-purple-300'>
                      上次听到这
                    </span>
                  )}
                  {ch.duration > 0 && (
                    <span className='shrink-0 text-xs text-gray-400'>
                      {formatChapterDuration(ch.duration)}
                    </span>
                  )}
                  <Play size={14} className='shrink-0 text-gray-400' />
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 页脚说明 */}
      <div className='mt-10 border-t border-gray-100 pt-4 text-center text-xs leading-relaxed text-gray-400 dark:border-gray-800'>
        内容来自哔哩哔哩公开视频，仅供个人收听；不下载、不转存音频。
        <br />
        分类与筛选规则参考开源项目 fengqiao57/abts（MIT 协议）。
      </div>
    </div>
  );
}

function BookCard({
  book,
  onOpen,
}: {
  book: BiliBook;
  onOpen: (b: BiliBook) => void;
}) {
  return (
    <button
      onClick={() => onOpen(book)}
      className='overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800'
    >
      {book.pic ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={book.pic}
          alt={book.title}
          className='aspect-video w-full object-cover'
          loading='lazy'
        />
      ) : (
        <div className='flex aspect-video w-full items-center justify-center bg-gray-100 dark:bg-gray-700'>
          <Headphones size={24} className='text-gray-400' />
        </div>
      )}
      <div className='p-2'>
        <div className='line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-gray-900 dark:text-gray-100'>
          {book.title}
        </div>
        <div className='mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
          <span className='truncate'>{book.author}</span>
          {book.durationText && (
            <span className='ml-2 shrink-0'>{book.durationText}</span>
          )}
        </div>
      </div>
    </button>
  );
}
