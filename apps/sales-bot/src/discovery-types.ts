export type BusinessDiscoveryProvider = 'ARES' | 'GEOAPIFY' | 'GOOGLE_PLACES';

export type BusinessSearchResult = {
  id: string;
  name: string;
  provider: BusinessDiscoveryProvider;
  sourceUrl: string;
  websiteUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  registrationId?: string;
  naceCodes?: string[];
};
