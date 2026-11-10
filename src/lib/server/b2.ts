/* eslint-disable no-console */
import { getConfig } from '@/lib/config';

/**
 * Backblaze B2（S3 兼容 API）服务端工具
 *
 * 仅供服务端路由使用：B2 Application Key 只存在服务端，绝不下发给浏览器。
 * 播放方案：服务端用 S3 预签名 URL（SigV4，有效期 1 小时）签发单文件直链，
 * 前端拿到后走现有 directplay 通道（/play?source=directplay）直接播放。
 * 这样视频流不经过 Worker，浏览器直连 B2，Range/拖动进度天然可用。
 */

export interface B2Settings {
  keyId: string;
  applicationKey: string;
  bucket: string;
  endpoint: string;
  region: string;
}

export interface B2Video {
  /** B2 桶内的对象 key（文件名） */
  key: string;
  /** 展示标题（文件名美化后，见 B2_VIDEO_TITLE_OVERRIDES） */
  title: string;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间（ISO 字符串） */
  lastModified: string;
}

/** 预签名播放链接默认有效期（秒） */
export const B2_PRESIGNED_URL_EXPIRES_IN = 3600;

/** 已知影片的展示标题覆盖：key（文件名）→ 展示标题 */
export const B2_VIDEO_TITLE_OVERRIDES: Record<string, string> = {
  '笑傲江湖1.mp4': '笑傲江湖 第1-3集合集',
};

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.m3u8', '.flv', '.avi'];

/** 从站点配置读取 B2 设置；未配齐返回 null */
export async function getB2Settings(): Promise<B2Settings | null> {
  const config = await getConfig();
  const site = config.SiteConfig;
  const keyId = site.B2KeyId?.trim() || '';
  const applicationKey = site.B2ApplicationKey?.trim() || '';
  if (!keyId || !applicationKey) {
    return null;
  }
  return {
    keyId,
    applicationKey,
    bucket: site.B2BucketName?.trim() || 'moontvplus-ai-duanju',
    endpoint: site.B2Endpoint?.trim() || 's3.us-east-005.backblazeb2.com',
    region: site.B2Region?.trim() || 'us-east-005',
  };
}

/** 文件名 → 展示标题：命中覆盖表则用覆盖标题，否则去掉扩展名 */
export function prettifyB2Title(key: string): string {
  const override = B2_VIDEO_TITLE_OVERRIDES[key];
  if (override) {
    return override;
  }
  const base = key.split('/').pop() || key;
  return base.replace(/\.[^.]+$/, '');
}

// ---------------------------------------------------------------------------
// AWS SigV4 签名（Web Crypto，Node.js runtime 与 Cloudflare Workers 均可用）
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return toHex(digest);
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function getSignatureKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/** S3 key 按段编码（保留 / 分隔符） */
function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate()
  )}`;
  const amzDate = `${dateStamp}T${pad(now.getUTCHours())}${pad(
    now.getUTCMinutes()
  )}${pad(now.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

/**
 * 生成 S3 GET 预签名 URL（仅单文件读取权限，有效期 expiresIn 秒）
 * 调用方必须是站长鉴权通过后的服务端路由。
 */
export async function createB2PresignedUrl(
  settings: B2Settings,
  key: string,
  expiresIn: number = B2_PRESIGNED_URL_EXPIRES_IN
): Promise<string> {
  const { amzDate, dateStamp } = amzDates(new Date());
  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const canonicalUri = `/${settings.bucket}/${encodeS3Key(key)}`;
  const credential = `${settings.keyId}/${scope}`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map(
      (name) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(queryParams[name])}`
    )
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQueryString,
    `host:${settings.endpoint}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(
    settings.applicationKey,
    dateStamp,
    settings.region,
    's3'
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `https://${settings.endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/**
 * 列出 B2 桶内的视频文件（S3 ListObjectsV2，服务端签名请求）
 * 按最后修改时间倒序返回。
 */
export async function listB2Videos(
  settings: B2Settings
): Promise<B2Video[]> {
  const { amzDate, dateStamp } = amzDates(new Date());
  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const emptyHash = await sha256Hex('');

  const query: Record<string, string> = {
    'list-type': '2',
    'max-keys': '100',
  };
  const canonicalQueryString = Object.keys(query)
    .sort()
    .map(
      (name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`
    )
    .join('&');

  const canonicalHeaders = [
    `host:${settings.endpoint}`,
    `x-amz-content-sha256:${emptyHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n');
  const canonicalRequest = [
    'GET',
    `/${settings.bucket}`,
    canonicalQueryString,
    canonicalHeaders,
    'host;x-amz-content-sha256;x-amz-date',
    emptyHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(
    settings.applicationKey,
    dateStamp,
    settings.region,
    's3'
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const url = `https://${settings.endpoint}/${settings.bucket}?${canonicalQueryString}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${settings.keyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      'x-amz-content-sha256': emptyHash,
      'x-amz-date': amzDate,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(
      `[B2] ListObjectsV2 失败: ${response.status} ${response.statusText} ${text.slice(0, 500)}`
    );
    throw new Error(`B2 列表请求失败（${response.status}）`);
  }

  const xml = await response.text();
  const videos: B2Video[] = [];
  const contentBlocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
  for (const block of contentBlocks) {
    const keyMatch = block.match(/<Key>([\s\S]*?)<\/Key>/);
    const sizeMatch = block.match(/<Size>([\s\S]*?)<\/Size>/);
    const lastModifiedMatch = block.match(
      /<LastModified>([\s\S]*?)<\/LastModified>/
    );
    if (!keyMatch) {
      continue;
    }
    let key = keyMatch[1].trim();
    try {
      key = decodeURIComponent(key);
    } catch {
      // 非编码 key，直接使用原文
    }
    const lowerKey = key.toLowerCase();
    if (!VIDEO_EXTENSIONS.some((ext) => lowerKey.endsWith(ext))) {
      continue;
    }
    videos.push({
      key,
      title: prettifyB2Title(key),
      size: sizeMatch ? parseInt(sizeMatch[1], 10) || 0 : 0,
      lastModified: lastModifiedMatch ? lastModifiedMatch[1].trim() : '',
    });
  }

  videos.sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
  return videos;
}
