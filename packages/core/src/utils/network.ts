import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const privateIpv4 = (host: string): boolean => {
  const parts = host.split('.').map(Number);
  const [a, b, c] = parts;
  if (a === undefined || b === undefined || c === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const privateIpv6 = (host: string): boolean => {
  const address = host.toLowerCase();
  return (
    address === '::' ||
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    /^fe[89ab]/u.test(address) ||
    address.startsWith('ff') ||
    address.startsWith('2001:db8:') ||
    address.startsWith('::ffff:')
  );
};

const assertPublicIp = (hostname: string): void => {
  const version = isIP(hostname);
  if (
    (version === 4 && privateIpv4(hostname)) ||
    (version === 6 && privateIpv6(hostname))
  ) {
    throw new Error('Private or special-purpose IP addresses are not allowed');
  }
};

export const assertPublicHttpUrl = (value: string): URL => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP(S) URLs are allowed');
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new Error('Local network URLs are not allowed');
  }
  assertPublicIp(hostname);
  return url;
};

export const assertPublicHttpUrlResolved = async (
  value: string,
): Promise<URL> => {
  const url = assertPublicHttpUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(hostname)) return url;

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0)
    throw new Error('The URL hostname did not resolve to an address');
  addresses.forEach(({ address }) => assertPublicIp(address));
  return url;
};
