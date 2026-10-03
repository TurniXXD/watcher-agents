export const normalizedDomain = (value: string): string => {
  const withProtocol = /^https?:\/\//iu.test(value)
    ? value
    : `https://${value}`;
  return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./u, '');
};

export const canonicalDomainUrl = (value: string): string =>
  `https://${normalizedDomain(value)}`;

export const filterEquals = (field: string, value: string): string =>
  `${field}[eq]:${value}`;

export const filterAnd = (...filters: string[]): string =>
  `and(${filters.join(',')})`;
