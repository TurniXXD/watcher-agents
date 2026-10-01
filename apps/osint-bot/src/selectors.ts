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
  const addressMatch = input.match(/^(?:adresa|address)\s*:\s*(.+)$/iu);
  if (addressMatch?.[1]?.trim())
    selectors.push({
      type: 'ADDRESS',
      value: addressMatch[1].trim(),
      original: addressMatch[0],
      depth: 0,
    });
  const ipCandidate = input.match(/^(?:ip\s*:\s*)?([^\s]+)$/iu)?.[1];
  if (ipCandidate && isIP(ipCandidate) !== 0)
    selectors.push({
      type: 'IP_ADDRESS',
      value: ipCandidate.toLowerCase(),
      original: input,
      depth: 0,
    });
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
  const explicitUsername = input.match(
    /^(?:username|uživatel)\s*:\s*@?([a-z0-9_.-]{1,64})$/iu,
  );
  if (explicitUsername?.[1])
    selectors.push({
      type: 'USERNAME',
      value: explicitUsername[1],
      original: input,
      depth: 0,
    });
  const githubUsername = input.match(
    /^(?:github)\s*:\s*@?([a-z0-9-]{1,39})$/iu,
  );
  if (githubUsername?.[1])
    selectors.push({
      type: 'GITHUB_PROFILE',
      value: githubUsername[1],
      original: input,
      depth: 0,
    });
  const redditUsername = input.match(
    /^(?:reddit)\s*:\s*(?:u\/|@)?([a-z0-9_-]{3,20})$/iu,
  );
  if (redditUsername?.[1])
    selectors.push({
      type: 'REDDIT_USERNAME',
      value: redditUsername[1],
      original: input,
      depth: 0,
    });
  const twitterUsername = input.match(
    /^(?:x|twitter)\s*:\s*@?([a-z0-9_]{1,15})$/iu,
  );
  if (twitterUsername?.[1])
    selectors.push({
      type: 'TWITTER_USERNAME',
      value: twitterUsername[1],
      original: input,
      depth: 0,
    });
  const orcidMatch = input.match(
    /(?:orcid(?:\.org)?[/:\s]*)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b/iu,
  );
  if (orcidMatch?.[1])
    selectors.push({
      type: 'ORCID',
      value: orcidMatch[1].toUpperCase(),
      original: orcidMatch[0],
      depth: 0,
    });
  const doiMatch = input.match(/\b(10\.\d{4,9}\/[^\s]+)$/iu);
  if (doiMatch?.[1])
    selectors.push({
      type: 'DOI',
      value: doiMatch[1].replace(/[),.;]+$/u, '').toLowerCase(),
      original: doiMatch[0],
      depth: 0,
    });
  const ethereumMatch = input.match(/\b0x[a-f0-9]{40}\b/iu);
  if (ethereumMatch)
    selectors.push({
      type: 'ETHEREUM_ADDRESS',
      value: ethereumMatch[0].toLowerCase(),
      original: ethereumMatch[0],
      depth: 0,
    });
  const bitcoinMatch = input.match(
    /\b(?:bc1[a-z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/u,
  );
  if (bitcoinMatch)
    selectors.push({
      type: 'BITCOIN_ADDRESS',
      value: bitcoinMatch[0],
      original: bitcoinMatch[0],
      depth: 0,
    });
  const phoneMatch = input.match(
    /^(?:telefon|phone)\s*:\s*(\+?[\d ()-]{7,25})$/iu,
  );
  if (phoneMatch?.[1])
    selectors.push({
      type: 'PHONE_NUMBER',
      value: phoneMatch[1].replace(/[ ()-]/gu, ''),
      original: input,
      depth: 0,
    });
  const urlMatch = input.match(/https?:\/\/[^\s,;]+/iu);
  if (urlMatch) {
    const url = new URL(urlMatch[0]);
    const host = url.hostname.replace(/^www\./u, '').toLowerCase();
    const path = url.pathname.split('/').filter(Boolean);
    if (host === 'github.com' && path[0])
      selectors.push({
        type: 'GITHUB_PROFILE',
        value: path[0],
        original: urlMatch[0],
        depth: 0,
      });
    else if (/(^|\.)linkedin\.com$/iu.test(host) && path[0] === 'in' && path[1])
      selectors.push({
        type: 'LINKEDIN_PUBLIC_PROFILE_URL',
        value: url.toString(),
        original: urlMatch[0],
        depth: 0,
      });
    else if (['x.com', 'twitter.com'].includes(host) && path[0])
      selectors.push({
        type: 'TWITTER_USERNAME',
        value: path[0],
        original: urlMatch[0],
        depth: 0,
      });
    else if (host === 'reddit.com' && path[0] === 'user' && path[1])
      selectors.push({
        type: 'REDDIT_USERNAME',
        value: path[1],
        original: urlMatch[0],
        depth: 0,
      });
    else if (/(^|\.)youtube\.com$/iu.test(host) && path.length > 0)
      selectors.push({
        type: 'YOUTUBE_CHANNEL',
        value: url.toString(),
        original: urlMatch[0],
        depth: 0,
      });
    else if (host === 'orcid.org' && path[0])
      selectors.push({
        type: 'ORCID',
        value: path[0].toUpperCase(),
        original: urlMatch[0],
        depth: 0,
      });
    else if (host === 'doi.org' && path.length > 0)
      selectors.push({
        type: 'DOI',
        value: path.join('/').toLowerCase(),
        original: urlMatch[0],
        depth: 0,
      });
    else
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
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    selectors.push({
      type: 'EMAIL',
      value: email,
      original: emailMatch[0],
      depth: 0,
    });
    selectors.push({
      type: 'DOMAIN',
      value: normalizeDomain(email.split('@')[1] ?? ''),
      original: emailMatch[0],
      depth: 1,
    });
  }
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
