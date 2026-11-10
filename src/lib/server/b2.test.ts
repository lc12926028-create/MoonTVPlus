/**
 * B2 SigV4 签名交叉验证测试
 *
 * 用 Node 原生 crypto（createHmac/createHash）独立重算签名，
 * 与 src/lib/server/b2.ts（Web Crypto 实现）的结果对比，
 * 防止签名实现里的编码/排序/密钥派生错误导致 B2 拒绝请求。
 */
import { TextDecoder, TextEncoder } from 'util';
import { createHash, createHmac, webcrypto } from 'crypto';

// jsdom 测试环境不提供 TextEncoder/TextDecoder/crypto 全局量（生产环境的
// Node.js runtime 与 Cloudflare Workers 自带），先补上再加载被测模块。
(globalThis as unknown as Record<string, unknown>).TextEncoder =
  TextEncoder;
(globalThis as unknown as Record<string, unknown>).TextDecoder =
  TextDecoder;
(globalThis as unknown as Record<string, unknown>).crypto = webcrypto;

import type { B2Settings } from '@/lib/server/b2';

const { createB2PresignedUrl, prettifyB2Title } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/lib/server/b2') as typeof import('@/lib/server/b2');

const FAKE_SETTINGS: B2Settings = {
  keyId: 'testKeyId123',
  applicationKey: 'testApplicationKey456',
  bucket: 'moontvplus-ai-duanju',
  endpoint: 's3.us-east-005.backblazeb2.com',
  region: 'us-east-005',
};

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

describe('B2 预签名 URL', () => {
  it('签名与 Node 原生 crypto 独立重算结果一致', async () => {
    const url = await createB2PresignedUrl(
      FAKE_SETTINGS,
      '笑傲江湖1.mp4',
      3600
    );
    const parsed = new URL(url);

    // 结构断言：中文 key 按段编码，桶名前缀正确
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('s3.us-east-005.backblazeb2.com');
    expect(parsed.pathname).toBe(
      '/moontvplus-ai-duanju/%E7%AC%91%E5%82%B2%E6%B1%9F%E6%B9%961.mp4'
    );

    const params = parsed.searchParams;
    const amzDate = params.get('X-Amz-Date') || '';
    const dateStamp = amzDate.slice(0, 8);
    const credential = params.get('X-Amz-Credential') || '';
    const signature = params.get('X-Amz-Signature') || '';

    expect(params.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(credential).toBe(
      `testKeyId123/${dateStamp}/us-east-005/s3/aws4_request`
    );
    expect(params.get('X-Amz-Expires')).toBe('3600');
    expect(params.get('X-Amz-SignedHeaders')).toBe('host');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);

    // 独立重算：按 AWS SigV4 规范重建规范请求与待签字符串
    const canonicalQueryString = [...params.keys()]
      .filter((name) => name !== 'X-Amz-Signature')
      .sort()
      .map(
        (name) =>
          `${encodeURIComponent(name)}=${encodeURIComponent(
            params.get(name) || ''
          )}`
      )
      .join('&');
    const canonicalRequest = [
      'GET',
      parsed.pathname,
      canonicalQueryString,
      `host:${parsed.hostname}`,
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const scope = `${dateStamp}/us-east-005/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmac(`AWS4${FAKE_SETTINGS.applicationKey}`, dateStamp);
    const kRegion = hmac(kDate, 'us-east-005');
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const expected = hmac(kSigning, stringToSign).toString('hex');

    expect(signature).toBe(expected);
  });

  it('已知影片标题取覆盖标题，未知文件去扩展名', () => {
    expect(prettifyB2Title('笑傲江湖1.mp4')).toBe('笑傲江湖 第1-3集合集');
    expect(prettifyB2Title('其他短剧.mp4')).toBe('其他短剧');
  });
});
