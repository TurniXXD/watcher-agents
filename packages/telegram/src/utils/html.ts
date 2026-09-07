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

export const sourceLink = (
  source: string,
  rawUrl: string,
  labelLimit = 100,
): string => {
  const label = htmlText(source, labelLimit);
  const url = new URL(rawUrl).toString();
  return url.length <= 2048
    ? `<a href="${escapeHtml(url)}">${label}</a>`
    : label;
};

export const optionalSourceLink = (
  source: string,
  rawUrl: unknown,
  labelLimit = 100,
): string => {
  if (typeof rawUrl !== 'string' || !rawUrl)
    return htmlText(source, labelLimit);
  try {
    return sourceLink(source, rawUrl, labelLimit);
  } catch {
    return htmlText(source, labelLimit);
  }
};
