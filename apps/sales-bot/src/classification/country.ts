import type { CountryDetection, EntityClassificationInput } from './types.js';

const countries = {
  CZ: { name: 'Czechia', phone: '+420', tlds: ['cz'] },
  DE: { name: 'Germany', phone: '+49', tlds: ['de'] },
  SK: { name: 'Slovakia', phone: '+421', tlds: ['sk'] },
  PL: { name: 'Poland', phone: '+48', tlds: ['pl'] },
  AT: { name: 'Austria', phone: '+43', tlds: ['at'] },
  GB: { name: 'United Kingdom', phone: '+44', tlds: ['uk'] },
} as const;

const addressPatterns: Record<keyof typeof countries, RegExp> = {
  CZ: /(?:^|[^\p{L}])(?:czechia|czech republic|cesko|ceska republika|česko|česká republika)(?:$|[^\p{L}])/iu,
  DE: /(?:^|[^\p{L}])(?:germany|deutschland|německo)(?:$|[^\p{L}])/iu,
  SK: /(?:^|[^\p{L}])(?:slovakia|slovensko)(?:$|[^\p{L}])/iu,
  PL: /(?:^|[^\p{L}])(?:poland|polska|polsko)(?:$|[^\p{L}])/iu,
  AT: /(?:^|[^\p{L}])(?:austria|österreich|rakousko)(?:$|[^\p{L}])/iu,
  GB: /(?:^|[^\p{L}])(?:united kingdom|great britain|uk)(?:$|[^\p{L}])/iu,
};

const result = (
  code: keyof typeof countries,
  confidence: number,
  source: CountryDetection['source'],
  reason: string,
): CountryDetection => ({
  code,
  name: countries[code].name,
  confidence,
  source,
  reason,
});

export const detectCountry = (
  input: EntityClassificationInput,
): CountryDetection | undefined => {
  if (input.address) {
    for (const [code, pattern] of Object.entries(addressPatterns)) {
      if (pattern.test(input.address)) {
        return result(
          code as keyof typeof countries,
          0.98,
          'company_address',
          'Explicit country found in the company address',
        );
      }
    }
  }

  const registrationCode = input.registrationCountryCode?.toUpperCase();
  if (registrationCode && registrationCode in countries) {
    return result(
      registrationCode as keyof typeof countries,
      0.97,
      'company_registration',
      'Country supplied by a company registry record',
    );
  }

  const discoveryCode = input.discoveryCountryCode?.toUpperCase();
  if (discoveryCode && discoveryCode in countries) {
    return result(
      discoveryCode as keyof typeof countries,
      0.94,
      'discovery_metadata',
      'Country supplied as structured discovery metadata',
    );
  }

  const compactPhone = input.phone?.replaceAll(/[\s().-]/gu, '');
  if (compactPhone) {
    for (const [code, country] of Object.entries(countries)) {
      if (compactPhone.startsWith(country.phone)) {
        return result(
          code as keyof typeof countries,
          0.9,
          'phone_country_code',
          `Public phone number uses ${country.phone}`,
        );
      }
    }
  }

  if (input.websiteUrl) {
    const hostname = new URL(input.websiteUrl).hostname.toLowerCase();
    const tld = hostname.split('.').at(-1);
    for (const [code, country] of Object.entries(countries)) {
      if (tld && country.tlds.includes(tld as never)) {
        return result(
          code as keyof typeof countries,
          0.62,
          'domain_tld',
          `Country-code domain .${tld} is a weak country signal`,
        );
      }
    }
  }

  return undefined;
};
