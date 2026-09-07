export type HtmlLink = {
  url: string;
  text: string;
};

export const decodeHtmlText = (value: string): string =>
  value
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replace(/\s+/gu, ' ')
    .trim();

export const extractHtmlLinks = (html: string, baseUrl: string): HtmlLink[] => {
  const links = new Map<string, HtmlLink>();
  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
  )) {
    try {
      const url = new URL(match[1]!, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = '';
      const canonical = url.toString();
      const text = decodeHtmlText(match[2] ?? '');
      if (!links.has(canonical)) links.set(canonical, { url: canonical, text });
    } catch {
      // Ignore malformed links from untrusted HTML.
    }
  }
  return [...links.values()];
};
