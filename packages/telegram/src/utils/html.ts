export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const htmlText = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  let output = '';
  for (const character of normalized) {
    const escaped = escapeHtml(character);
    if (output.length + escaped.length > limit - 1) return `${output}…`;
    output += escaped;
  }
  return output;
};

export const sourceLink = (source: string, rawUrl: string): string => {
  const label = htmlText(source, 100);
  const url = new URL(rawUrl).toString();
  return url.length <= 2048
    ? `<a href="${escapeHtml(url)}">${label}</a>`
    : label;
};

export const optionalSourceLink = (source: string, rawUrl: unknown): string => {
  if (typeof rawUrl !== 'string' || !rawUrl) return htmlText(source, 100);
  try {
    return sourceLink(source, rawUrl);
  } catch {
    return htmlText(source, 100);
  }
};
