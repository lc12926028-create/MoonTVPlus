'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';

/**
 * 搜索框辅助：历史面板 + 标题联想下拉。
 *
 * 影视搜索的历史走账号存储（db.client），这里只提供面板 UI；
 * 漫画 / 音乐没有账号级历史，各自用一份 localStorage 历史（互不相通），
 * 读写收在本文件的三个 local 函数里，上限同为 10 条。
 */

export const LOCAL_SEARCH_HISTORY_LIMIT = 10;

export function loadLocalSearchHistory(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return Array.from(
      new Set(arr.filter((x): x is string => typeof x === 'string'))
    ).slice(0, LOCAL_SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** 把关键词置顶写入本地历史（去重、最新在前、截断到上限），返回新列表。 */
export function pushLocalSearchHistory(key: string, keyword: string): string[] {
  const trimmed = keyword.trim();
  const current = loadLocalSearchHistory(key);
  if (!trimmed) return current;
  const next = [trimmed, ...current.filter((k) => k !== trimmed)].slice(
    0,
    LOCAL_SEARCH_HISTORY_LIMIT
  );
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // 忽略写入失败（隐私模式等）
  }
  return next;
}

export function clearLocalSearchHistory(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

/** 点面板外 / 按 Esc 关闭。返回挂到面板根节点的 ref。 */
function useDismissRef(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return ref;
}

export interface SearchAssistClassNames {
  panel?: string;
  header?: string;
  clearButton?: string;
  chip?: string;
  row?: string;
  rowTitle?: string;
  rowTag?: string;
}

const DEFAULT_PANEL =
  'absolute top-full left-0 right-0 z-[600] mt-1 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800';
const DEFAULT_HEADER = 'text-sm font-medium text-gray-700 dark:text-gray-200';
const DEFAULT_CLEAR =
  'inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400';
const DEFAULT_CHIP =
  'rounded-full bg-gray-500/10 px-4 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-300 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:bg-gray-600';
const DEFAULT_ROW =
  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-700';
const DEFAULT_ROW_TITLE = 'flex-1 truncate text-sm text-gray-700 dark:text-gray-300';
const DEFAULT_ROW_TAG =
  'shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400';

interface SearchHistoryPanelProps {
  history: string[];
  onSelect: (keyword: string) => void;
  onClear: () => void;
  onClose: () => void;
  classNames?: SearchAssistClassNames;
}

/** 搜索框聚焦且为空时，下方弹出的最近搜索历史面板（胶囊标签 + 清空入口）。 */
export function SearchHistoryPanel({
  history,
  onSelect,
  onClear,
  onClose,
  classNames,
}: SearchHistoryPanelProps) {
  const ref = useDismissRef(onClose);

  if (history.length === 0) {
    return null;
  }

  return (
    <div ref={ref} className={cn(DEFAULT_PANEL, classNames?.panel)}>
      <div className='mb-3 flex items-center justify-between'>
        <span className={cn(DEFAULT_HEADER, classNames?.header)}>搜索历史</span>
        <button
          type='button'
          onClick={onClear}
          className={cn(DEFAULT_CLEAR, classNames?.clearButton)}
        >
          <Trash2 className='h-3.5 w-3.5' />
          清空
        </button>
      </div>
      <div className='flex flex-wrap gap-2'>
        {history.map((item) => (
          <button
            key={item}
            type='button'
            onClick={() => onSelect(item)}
            className={cn(DEFAULT_CHIP, classNames?.chip)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface TitleSuggestionItem {
  title: string;
  tag?: string;
}

interface TitleSuggestionListProps {
  items: TitleSuggestionItem[];
  onSelect: (title: string) => void;
  onClose: () => void;
  classNames?: SearchAssistClassNames;
}

/** 输入时的标题联想下拉：一行一条，片名在左、类型小标签在右。 */
export function TitleSuggestionList({
  items,
  onSelect,
  onClose,
  classNames,
}: TitleSuggestionListProps) {
  const ref = useDismissRef(onClose);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-full left-0 right-0 z-[600] mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800',
        classNames?.panel
      )}
    >
      {items.map((item) => (
        <button
          key={item.title}
          type='button'
          onClick={() => onSelect(item.title)}
          className={cn(DEFAULT_ROW, classNames?.row)}
        >
          <span className={cn(DEFAULT_ROW_TITLE, classNames?.rowTitle)}>
            {item.title}
          </span>
          {item.tag ? (
            <span className={cn(DEFAULT_ROW_TAG, classNames?.rowTag)}>
              {item.tag}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
