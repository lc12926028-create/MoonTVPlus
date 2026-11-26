import { ChevronLeft, ExternalLink, Spade } from 'lucide-react';
import Link from 'next/link';

// 戴长胜掼蛋课：共 6 个视频，12 节课。回放均为腾讯会议分享链接，
// 观看需用微信登录的腾讯会议账号（手机号登录的账号看不到）；
// 主持人未开「允许成员下载和转存」，只能看不能下，故只做外链、不嵌播放器。
const LESSONS = [
  {
    name: '第一课',
    date: '2023/07/01 18:38',
    duration: '1 小时 58 分 45 秒',
    note: '',
    url: 'https://meeting.tencent.com/rs/2qDLWjAK45',
  },
  {
    name: '第二课',
    date: '2023/07/02 18:11',
    duration: '1 小时 57 分 15 秒',
    note: '掼蛋进阶教学',
    url: 'https://meeting.tencent.com/crm/2MOpVnVl58',
  },
  {
    name: '第三课',
    date: '',
    duration: '',
    note: '',
    url: 'https://meeting.tencent.com/rs/KnWLZxj236',
  },
  {
    name: '第四课',
    date: '',
    duration: '',
    note: '',
    url: 'https://meeting.tencent.com/rs/l7qGDgx25f',
  },
  {
    name: '第五课',
    date: '',
    duration: '',
    note: '',
    url: 'https://meeting.tencent.com/rs/l6eLMz0Na5',
  },
  {
    name: '第六课',
    date: '',
    duration: '',
    note: '',
    url: 'https://meeting.tencent.com/rs/2jjLarb22e',
  },
];

export default function GuandanPage() {
  return (
    <div className='mx-auto max-w-6xl px-3 pb-16 pt-4 sm:px-6'>
      {/* 头部 */}
      <div className='mb-4 flex items-center gap-2'>
        <Link
          href='/'
          prefetch={false}
          className='rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          title='返回首页'
        >
          <ChevronLeft size={20} />
        </Link>
        <Spade size={22} className='text-orange-500' />
        <h1 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
          掼蛋课程
        </h1>
        <span className='text-sm text-gray-500 dark:text-gray-400'>
          共 6 个视频，12 节课
        </span>
      </div>

      {/* 提示 */}
      <div className='mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'>
        观看需用微信登录的腾讯会议账号（手机号登录的账号看不到这课）。点开课程会在新标签打开腾讯会议回放页。
      </div>

      {/* 课程列表 */}
      <div className='flex flex-col gap-3'>
        {LESSONS.map((lesson) => (
          <a
            key={lesson.name}
            href={lesson.url}
            target='_blank'
            rel='noopener noreferrer'
            className='group flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-orange-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-orange-500'
          >
            <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-500 dark:bg-orange-950/60'>
              <Spade size={20} />
            </div>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-base font-medium text-gray-900 dark:text-gray-100'>
                {lesson.name}
                {lesson.note ? ` · ${lesson.note}` : ''}
              </div>
              <div className='truncate text-sm text-gray-500 dark:text-gray-400'>
                {lesson.date || '日期待补充'}
                {' · '}
                {lesson.duration || '时长待补充'}
              </div>
            </div>
            <span className='hidden shrink-0 text-sm text-gray-400 group-hover:text-orange-500 sm:block'>
              腾讯会议回放
            </span>
            <ExternalLink
              size={16}
              className='shrink-0 text-gray-400 group-hover:text-orange-500'
            />
          </a>
        ))}
      </div>
    </div>
  );
}
