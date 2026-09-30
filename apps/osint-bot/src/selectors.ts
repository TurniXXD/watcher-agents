import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { z } from 'zod';

export const selectorTypeSchema = z.enum([
  'ICO',
  'COMPANY_NAME',
  'FULL_NAME',
  'EMAIL',
  'USERNAME',
  'WEBSITE',
  'DOMAIN',
  'PHONE_NUMBER',
  'GITHUB_PROFILE',
  'LINKEDIN_PUBLIC_PROFILE_URL',
  'TWITTER_USERNAME',
  'REDDIT_USERNAME',
  'YOUTUBE_CHANNEL',
  'ORCID',
  'DOI',
  'BITCOIN_ADDRESS',
  'ETHEREUM_ADDRESS',
  'IP_ADDRESS',
  'ADDRESS',
]);
export type SelectorType = z.infer<typeof selectorTypeSchema>;
export type Selector = {
  type: SelectorType;
  value: string;
  original: string;
  depth: number;
};

export const normalizeIco = (input: string): string => {
  const digits = input.replace(/\s/gu, '');
  if (!/^\d{8}$/u.test(digits))
    throw new Error('IČO musí mít přesně 8 číslic.');
  const weighted = [...digits.slice(0, 7)].reduce(
    (sum, digit, index) => sum + Number(digit) * (8 - index),
    0,
  );
  const remainder = (11 - (weighted % 11)) % 11;
  const checkDigit = remainder === 10 ? 0 : remainder;
  if (checkDigit !== Number(digits[7]))
    throw new Error('IČO má neplatnou kontrolní číslici.');
  return digits;
};

export const normalizeDomain = (input: string): string => {
  const trimmed = input.trim();
  const url = new URL(
    /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`,
  );
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Doména musí být HTTP(S).');
  const host = domainToASCII(
    url.hostname
      .toLowerCase()
      .replace(/^www\./u, '')
      .replace(/\.$/u, ''),
  );
  if (
    !/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/u.test(host) ||
    host.includes('..') ||
    isIP(host) !== 0 ||
    /\.(?:local|internal|localhost|test|invalid)$/u.test(host)
  )
    throw new Error('Neplatná doména.');
  return host;
};

export const parseSelectors = (query: string): Selector[] => {
  const input = query.trim().slice(0, 500);
  if (!input) throw new Error('Zadej firmu, IČO nebo veřejnou doménu.');
  const selectors: Selector[] = [];
  const icoMatch = input.match(/\bIČO\s*:?\s*(\d[\d\s]{6,12}\d)\b/iu);
  if (icoMatch?.[1])
    selectors.push({
      type: 'ICO',
      value: normalizeIco(icoMatch[1]),
      original: icoMatch[0],
      depth: 0,
    });
  else if (/^\d{8}$/u.test(input))
    selectors.push({
      type: 'ICO',
      value: normalizeIco(input),
      original: input,
      depth: 0,
    });
  const urlMatch = input.match(/https?:\/\/[^\s,;]+/iu);
  if (urlMatch) {
    selectors.push({
      type: 'DOMAIN',
      value: normalizeDomain(urlMatch[0]),
      original: urlMatch[0],
      depth: 0,
    });
  } else {
    const domainMatch = input.match(
      /(?:^|\s)(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?=$|[\s,.!?])/iu,
    );
    if (domainMatch)
      selectors.push({
        type: 'DOMAIN',
        value: normalizeDomain(domainMatch[0]),
        original: domainMatch[0].trim(),
        depth: 0,
      });
  }
  const emailMatch = input.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  if (emailMatch)
    selectors.push({
      type: 'EMAIL',
      value: emailMatch[0].toLowerCase(),
      original: emailMatch[0],
      depth: 0,
    });
  if (selectors.length === 0)
    selectors.push({
      type: /\b(firma|firmě|společnost)\b|s\.r\.o\.|a\.s\./iu.test(input)
        ? 'COMPANY_NAME'
        : 'FULL_NAME',
      value: input,
      original: input,
      depth: 0,
    });
  return [
    ...new Map(
      selectors.map((selector) => [
        `${selector.type}:${selector.value}`,
        selector,
      ]),
    ).values(),
  ];
};
