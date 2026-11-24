'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/cn';
import {
  deleteMangaShelf,
  getAllMangaShelf,
  saveMangaShelf,
} from '@/lib/db.client';
import {
  MangaSearchItem,
  MangaShelfItem,
  MangaSource,
} from '@/lib/manga.types';

import {
  mangaCardItem,
  mangaItemDetailHref,
} from '@/components/media/adapters';
import EmptyState from '@/components/media/EmptyState';
import {
  LIBRARY_BUTTON,
  LIBRARY_FIELD,
  LIBRARY_MUTED,
  LIBRARY_PANEL,
} from '@/components/media/library';
import {
  clearLocalSearchHistory,
  loadLocalSearchHistory,
  pushLocalSearchHistory,
  SearchHistoryPanel,
  TitleSuggestionList,
  type TitleSuggestionItem,
} from '@/components/SearchAssist';
import MediaCard from '@/components/media/MediaCard';
import MediaGrid from '@/components/media/MediaGrid';
import MediaGridSkeleton from '@/components/media/MediaGridSkeleton';
import MediaSectionHeader from '@/components/media/MediaSectionHeader';
import ShelfChipButton from '@/components/media/ShelfChipButton';

const MANGA_SEARCH_STATE_KEY = 'manga_search_state';
// 漫画搜索历史单独存本机（与影视的账号历史分开），上限 10 条
const MANGA_SEARCH_HISTORY_KEY = 'manga_search_history';

export default function MangaSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q')?.trim() || '';
  const urlSourceId = searchParams.get('sourceId') || '';

  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [results, setResults] = useState<MangaSearchItem[]>([]);
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const [lastSearchedSourceId, setLastSearchedSourceId] = useState('');
  const restoredRef = useRef(false);
  const forceNextUrlSearchRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentSearchKeyRef = useRef('');
  const pendingResultsRef = useRef<MangaSearchItem[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const [useFluidSearch, setUseFluidSearch] = useState(true);
  // 搜索历史面板 / 标题联想
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<
    TitleSuggestionItem[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const getCacheKey = useCallback(
    (keyword: string, selectedSourceId: string) => {
      return `manga_search_cache_${
        selectedSourceId || 'all'
      }_${keyword.trim()}`;
    },
    []
  );

  const getCachedResults = useCallback(
    (keyword: string, selectedSourceId: string) => {
      if (typeof window === 'undefined' || !keyword.trim()) return null;
      try {
        const cached = sessionStorage.getItem(
          getCacheKey(keyword, selectedSourceId)
        );
        return cached ? (JSON.parse(cached) as MangaSearchItem[]) : null;
      } catch {
        return null;
      }
    },
    [getCacheKey]
  );

  const setCachedResults = useCallback(
    (
      keyword: string,
      selectedSourceId: string,
      nextResults: MangaSearchItem[]
    ) => {
      if (typeof window === 'undefined' || !keyword.trim()) return;
      try {
        sessionStorage.setItem(
          getCacheKey(keyword, selectedSourceId),
          JSON.stringify(nextResults)
        );
      } catch {
        // ignore session cache failures
      }
    },
    [getCacheKey]
  );

  const readFluidSearchSetting = useCallback(() => {
    if (typeof window === 'undefined') return true;
    try {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      if (savedFluidSearch !== null)
        return JSON.parse(savedFluidSearch) !== false;
    } catch {
      // ignore invalid localStorage values
    }
    return (
      (window as Window & { RUNTIME_CONFIG?: { FLUID_SEARCH?: boolean } })
        .RUNTIME_CONFIG?.FLUID_SEARCH !== false
    );
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // ignore close failures
      }
      eventSourceRef.current = null;
    }
  }, []);

  const clearPendingResults = useCallback(() => {
    pendingResultsRef.current = [];
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const appendBufferedResults = useCallback(
    (nextResults: MangaSearchItem[]) => {
      if (nextResults.length === 0) return;
      pendingResultsRef.current.push(...nextResults);
      if (!flushTimerRef.current) {
        flushTimerRef.current = window.setTimeout(() => {
          const toAppend = pendingResultsRef.current;
          pendingResultsRef.current = [];
          startTransition(() => {
            setResults((prev) => prev.concat(toAppend));
          });
          flushTimerRef.current = null;
        }, 80);
      }
    },
    []
  );

  const saveSearchState = useCallback(
    (nextState: {
      query: string;
      sourceId: string;
      results: MangaSearchItem[];
    }) => {
      if (typeof window === 'undefined') return;
      try {
        sessionStorage.setItem(
          MANGA_SEARCH_STATE_KEY,
          JSON.stringify(nextState)
        );
      } catch {
        // ignore session cache failures
      }
    },
    []
  );

  const restoreSearchState = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = sessionStorage.getItem(MANGA_SEARCH_STATE_KEY);
      return cached
        ? (JSON.parse(cached) as {
            query: string;
            sourceId: string;
            results: MangaSearchItem[];
          })
        : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setSearchHistory(loadLocalSearchHistory(MANGA_SEARCH_HISTORY_KEY));
    setUseFluidSearch(readFluidSearchSetting());

    fetch('/api/manga/sources')
      .then((res) => res.json())
      .then((data) => setSources(data.sources || []))
      .catch(() => undefined);

    getAllMangaShelf()
      .then(setShelf)
      .catch(() => undefined);

    return () => {
      closeEventSource();
      clearPendingResults();
    };
  }, [clearPendingResults, closeEventSource, readFluidSearchSetting]);

  const performSearch = useCallback(
    async (
      keyword: string,
      selectedSourceId: string,
      options?: { forceRefresh?: boolean }
    ) => {
      const trimmedQuery = keyword.trim();
      if (!trimmedQuery) return;

      // 记入本地搜索历史，并收起历史面板 / 联想下拉
      setSearchHistory(
        pushLocalSearchHistory(MANGA_SEARCH_HISTORY_KEY, trimmedQuery)
      );
      setShowHistoryPanel(false);
      setShowSuggestions(false);

      const normalizedSourceId = selectedSourceId || '';
      const searchKey = `${normalizedSourceId}::${trimmedQuery}`;
      const forceRefresh = options?.forceRefresh === true;

      closeEventSource();
      clearPendingResults();
      currentSearchKeyRef.current = searchKey;

      setLoading(true);
      setError('');
      setHasSearched(true);
      setLastSearchedQuery(trimmedQuery);
      setLastSearchedSourceId(normalizedSourceId);
      setTotalSources(0);
      setCompletedSources(0);

      const cached = forceRefresh
        ? null
        : getCachedResults(trimmedQuery, normalizedSourceId);
      if (cached) {
        setResults(cached);
        saveSearchState({
          query: trimmedQuery,
          sourceId: normalizedSourceId,
          results: cached,
        });
        setLoading(false);
        setTotalSources(1);
        setCompletedSources(1);
        return;
      }

      setResults([]);

      const currentFluidSearch = readFluidSearchSetting();
      setUseFluidSearch((prev) =>
        prev === currentFluidSearch ? prev : currentFluidSearch
      );

      const params = new URLSearchParams({ q: trimmedQuery });
      if (normalizedSourceId) params.set('sourceId', normalizedSourceId);

      if (currentFluidSearch) {
        const es = new EventSource(`/api/manga/search/ws?${params.toString()}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data || currentSearchKeyRef.current !== searchKey) return;
          try {
            const payload = JSON.parse(event.data);
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result':
                setCompletedSources((prev) =>
                  Math.max(prev + 1, payload.completedSources || 0)
                );
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  appendBufferedResults(payload.results as MangaSearchItem[]);
                }
                break;
              case 'source_error':
                setCompletedSources((prev) =>
                  Math.max(prev + 1, payload.completedSources || 0)
                );
                break;
              case 'error':
                setError(payload.error || '搜索失败');
                setLoading(false);
                closeEventSource();
                break;
              case 'complete': {
                setCompletedSources(
                  payload.completedSources || payload.totalSources || 0
                );
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    window.clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setResults((prev) => {
                      const nextResults = prev.concat(toAppend);
                      setCachedResults(
                        trimmedQuery,
                        normalizedSourceId,
                        nextResults
                      );
                      saveSearchState({
                        query: trimmedQuery,
                        sourceId: normalizedSourceId,
                        results: nextResults,
                      });
                      return nextResults;
                    });
                  });
                } else {
                  setResults((prev) => {
                    setCachedResults(trimmedQuery, normalizedSourceId, prev);
                    saveSearchState({
                      query: trimmedQuery,
                      sourceId: normalizedSourceId,
                      results: prev,
                    });
                    return prev;
                  });
                }
                setLoading(false);
                closeEventSource();
                break;
              }
            }
          } catch {
            // ignore malformed SSE payloads
          }
        };

        es.onerror = () => {
          if (currentSearchKeyRef.current !== searchKey) return;
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              window.clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setResults((prev) => prev.concat(toAppend));
            });
          }
          setLoading(false);
          closeEventSource();
        };
        return;
      }

      try {
        const res = await fetch(`/api/manga/search?${params.toString()}`);
        const data = await res.json();
        if (currentSearchKeyRef.current !== searchKey) return;
        if (!res.ok) throw new Error(data.error || '搜索失败');
        const nextResults = data.results || [];
        setResults(nextResults);
        setTotalSources(1);
        setCompletedSources(1);
        setCachedResults(trimmedQuery, normalizedSourceId, nextResults);
        saveSearchState({
          query: trimmedQuery,
          sourceId: normalizedSourceId,
          results: nextResults,
        });
      } catch (err) {
        if (currentSearchKeyRef.current !== searchKey) return;
        setError((err as Error).message);
        setResults([]);
      } finally {
        if (currentSearchKeyRef.current === searchKey) {
          setLoading(false);
        }
      }
    },
    [
      appendBufferedResults,
      clearPendingResults,
      closeEventSource,
      getCachedResults,
      readFluidSearchSetting,
      saveSearchState,
      setCachedResults,
    ]
  );

  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;

      if (!urlQuery) {
        const cachedState = restoreSearchState();
        if (cachedState?.query?.trim()) {
          setQuery(cachedState.query);
          setSourceId(cachedState.sourceId || '');
          setResults(cachedState.results || []);
          setHasSearched(true);
          setLastSearchedQuery(cachedState.query);
          setLastSearchedSourceId(cachedState.sourceId || '');
        }
        return;
      }
    }

    setQuery(urlQuery);
    setSourceId(urlSourceId);

    if (!urlQuery) {
      closeEventSource();
      clearPendingResults();
      setResults([]);
      setLoading(false);
      setHasSearched(false);
      setLastSearchedQuery('');
      setLastSearchedSourceId('');
      setTotalSources(0);
      setCompletedSources(0);
      setError('');
      return;
    }

    const forceRefresh = forceNextUrlSearchRef.current;
    forceNextUrlSearchRef.current = false;
    void performSearch(urlQuery, urlSourceId, { forceRefresh });
  }, [
    clearPendingResults,
    closeEventSource,
    performSearch,
    restoreSearchState,
    urlQuery,
    urlSourceId,
  ]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const params = new URLSearchParams({ q: trimmedQuery });
    if (sourceId) params.set('sourceId', sourceId);
    const nextUrl = `/manga/search?${params.toString()}`;
    if (urlQuery === trimmedQuery && urlSourceId === sourceId) {
      await performSearch(trimmedQuery, sourceId, { forceRefresh: true });
    } else {
      forceNextUrlSearchRef.current = true;
      router.replace(nextUrl);
    }
  };

  // 历史面板 / 联想下拉点选后：按指定关键词执行搜索
  const runSearchWithKeyword = (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setShowSuggestions(false);
    setShowHistoryPanel(false);

    const params = new URLSearchParams({ q: trimmed });
    if (sourceId) params.set('sourceId', sourceId);
    const nextUrl = `/manga/search?${params.toString()}`;
    if (urlQuery === trimmed && urlSourceId === sourceId) {
      void performSearch(trimmed, sourceId, { forceRefresh: true });
    } else {
      forceNextUrlSearchRef.current = true;
      router.replace(nextUrl);
    }
  };

  // 输入联想：防抖后用现有漫画搜索接口提炼标题（去重、最多 10 条）
  useEffect(() => {
    const kw = query.trim();
    if (!kw) {
      setTitleSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: kw });
      if (sourceId) params.set('sourceId', sourceId);
      fetch(`/api/manga/search?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data) => {
          const items: TitleSuggestionItem[] = [];
          const seen = new Set<string>();
          for (const item of (data.results || []) as MangaSearchItem[]) {
            const title = (item.title || '').trim();
            if (!title || seen.has(title.toLowerCase())) continue;
            seen.add(title.toLowerCase());
            items.push({
              title,
              tag: item.genre || item.status || item.sourceName || undefined,
            });
            if (items.length >= 10) break;
          }
          setTitleSuggestions(items);
          // 仅在输入框仍聚焦时才弹出，避免页面恢复状态时误弹
          if (
            searchInputRef.current &&
            document.activeElement === searchInputRef.current
          ) {
            setShowSuggestions(items.length > 0);
          }
        })
        .catch(() => undefined);
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, sourceId]);

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    if (lastSearchedQuery) params.set('q', lastSearchedQuery);
    if (lastSearchedSourceId) params.set('sourceId', lastSearchedSourceId);
    const queryString = params.toString();
    return queryString ? `/manga/search?${queryString}` : '/manga/search';
  }, [lastSearchedQuery, lastSearchedSourceId]);

  const toggleShelf = async (item: MangaSearchItem) => {
    const key = `${item.sourceId}+${item.id}`;
    if (shelf[key]) {
      await deleteMangaShelf(item.sourceId, item.id);
      setShelf((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const shelfItem: MangaShelfItem = {
      title: item.title,
      cover: item.cover,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      mangaId: item.id,
      saveTime: Date.now(),
      description: item.description,
      author: item.author,
      status: item.status,
    };
    await saveMangaShelf(item.sourceId, item.id, shelfItem);
    setShelf((prev) => ({ ...prev, [key]: shelfItem }));
  };

  return (
    <div className='space-y-6'>
      {/* 搜索框做成纸面书案的样式：一个实心纸面板托着输入、来源与搜索键。 */}
      <form
        className={cn(LIBRARY_PANEL, 'mx-auto max-w-4xl p-3 sm:p-4')}
        onSubmit={handleSearch}
      >
        <div className='flex flex-col gap-3 lg:flex-row'>
          <div className='relative flex-1'>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                if (value.trim()) {
                  setShowHistoryPanel(false);
                } else {
                  setShowSuggestions(false);
                  setShowHistoryPanel(true);
                }
              }}
              onFocus={() => {
                if (!query.trim()) {
                  setShowHistoryPanel(true);
                }
              }}
              placeholder='搜索漫画标题'
              aria-label='搜索漫画标题'
              autoComplete='off'
              className={LIBRARY_FIELD}
            />
            {showHistoryPanel && !query.trim() && (
              <SearchHistoryPanel
                history={searchHistory}
                onSelect={runSearchWithKeyword}
                onClear={() => {
                  clearLocalSearchHistory(MANGA_SEARCH_HISTORY_KEY);
                  setSearchHistory([]);
                  setShowHistoryPanel(false);
                }}
                onClose={() => setShowHistoryPanel(false)}
                classNames={{
                  panel:
                    'mt-2 border-library-edge bg-library-card shadow-lg dark:border-library-night-edge dark:bg-library-night-card',
                  header:
                    'font-book text-library-ink dark:text-library-night-ink',
                  clearButton:
                    'text-library-muted hover:text-red-500 dark:text-library-night-muted dark:hover:text-red-400',
                  chip: 'border border-library-edge bg-transparent px-3 py-1.5 text-xs text-library-ink hover:border-library-ochre hover:bg-library-ochre-tint hover:text-library-ochre dark:border-library-night-edge dark:bg-transparent dark:text-library-night-ink dark:hover:border-library-night-ochre dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre',
                }}
              />
            )}
            {showSuggestions && query.trim() && (
              <TitleSuggestionList
                items={titleSuggestions}
                onSelect={runSearchWithKeyword}
                onClose={() => setShowSuggestions(false)}
                classNames={{
                  panel:
                    'mt-2 border-library-edge bg-library-card shadow-lg dark:border-library-night-edge dark:bg-library-night-card',
                  row: 'px-3 py-2.5 hover:bg-library-ochre-tint dark:hover:bg-library-night-ochre-tint',
                  rowTitle: 'text-library-ink dark:text-library-night-ink',
                  rowTag:
                    'bg-library-ochre-tint text-library-ochre dark:bg-library-night-ochre-tint dark:text-library-night-ochre',
                }}
              />
            )}
          </div>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            aria-label='选择漫画来源'
            className={cn(LIBRARY_FIELD, 'cursor-pointer lg:w-56')}
          >
            <option value=''>全部来源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName || source.name}
              </option>
            ))}
          </select>
          <button className={cn(LIBRARY_BUTTON, 'lg:w-32')}>
            <Search className='h-4 w-4' /> 搜索
          </button>
        </div>
      </form>

      <section className='space-y-4'>
        <MediaSectionHeader
          title={`搜索结果${results.length > 0 ? `（${results.length}）` : ''}`}
          action={
            loading && useFluidSearch && totalSources > 0 ? (
              <span className={cn('shrink-0 text-xs', LIBRARY_MUTED)}>
                搜索中 {completedSources}/{totalSources}
              </span>
            ) : undefined
          }
        />
        {error && <EmptyState tone='error' description={error} />}
        {loading && results.length === 0 ? (
          <MediaGridSkeleton count={12} />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Search className='h-7 w-7' />}
            title={hasSearched ? '没有找到相关漫画' : '还没有开始搜索'}
            description={
              hasSearched
                ? '试试更短的关键词，或把来源切到「全部来源」。'
                : '在上面的输入框里输入标题，或直接回车搜索全部漫画源。'
            }
          />
        ) : (
          <MediaGrid>
            {results.map((item) => {
              const key = `${item.sourceId}+${item.id}`;
              return (
                <MediaCard
                  key={key}
                  item={{
                    ...mangaCardItem(item),
                    subtitle: item.author || item.status || item.description,
                  }}
                  href={mangaItemDetailHref(item, returnTo)}
                  overlayAction={
                    <ShelfChipButton
                      active={Boolean(shelf[key])}
                      onClick={() => toggleShelf(item)}
                    />
                  }
                />
              );
            })}
          </MediaGrid>
        )}
      </section>
    </div>
  );
}
