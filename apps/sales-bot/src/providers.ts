import { assertPublicHttpUrlResolved } from '@watcher/core';
import {
  fetchPublicHtml,
  decodeHtmlText,
  extractHtmlLinks,
} from '@watcher/sources/web';
import { z } from 'zod';

const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  websiteUrl: z.url(),
  sourceUrl: z.url().optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  countryCode: z.string().trim().length(2).optional(),
  languageCode: z.string().trim().min(2).max(12).optional(),
  phone: z.string().trim().min(7).max(40).optional(),
});
export type DiscoveredCompany = z.infer<typeof companySchema>;

export const discoverFromFeed = async (
  feedUrl: string,
): Promise<DiscoveredCompany[]> => {
  const url = await assertPublicHttpUrlResolved(feedUrl);
  const response = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Discovery feed HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error('Discovery feed exceeds 2 MB');
  return z.array(companySchema).max(1_000).parse(JSON.parse(body));
};

export type SiteAudit = {
  sourceUrl: string;
  title: string;
  textExcerpt: string;
  contactTextExcerpt?: string;
  htmlLanguage?: string;
  alternateLanguages: string[];
  hasContactPage: boolean;
  hasPrivacyPage: boolean;
  hasMobileViewport: boolean;
  hasDescription: boolean;
  foundEmail?: string;
  emailSourceUrl?: string;
  foundPhone?: string;
  phoneSourceUrl?: string;
};

export const extractPublicPhone = (html: string): string | undefined => {
  const encoded = html.match(/href\s*=\s*["']tel:([^"']+)["']/iu)?.[1];
  if (!encoded) return undefined;
  let phone: string;
  try {
    phone = decodeURIComponent(encoded).replaceAll('&nbsp;', ' ').trim();
  } catch {
    return undefined;
  }
  if (!/^\+?[\d\s().-]+$/u.test(phone)) return undefined;
  const digitCount = phone.replaceAll(/\D/gu, '').length;
  return digitCount >= 7 && digitCount <= 15 ? phone.slice(0, 40) : undefined;
};

export const auditWebsite = async (websiteUrl: string): Promise<SiteAudit> => {
  const homepage = await fetchPublicHtml(websiteUrl, { maximumBytes: 400_000 });
  const links = extractHtmlLinks(homepage.html, homepage.url).filter(
    (link) => new URL(link.url).hostname === new URL(homepage.url).hostname,
  );
  const contact = links.find((link) =>
    /contact|kontakt/iu.test(`${link.url} ${link.text}`),
  );
  const privacy = links.some((link) =>
    /privacy|gdpr|ochrana.osobn/iu.test(`${link.url} ${link.text}`),
  );
  let contactHtml = homepage.html;
  let emailSourceUrl = homepage.url;
  if (contact) {
    try {
      const page = await fetchPublicHtml(contact.url, {
        maximumBytes: 200_000,
      });
      contactHtml = page.html;
      emailSourceUrl = page.url;
    } catch {
      // Homepage observations remain usable when the contact page fails.
    }
  }
  const match = contactHtml.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  );
  const foundEmail = match?.[0]?.toLowerCase();
  const foundPhone = extractPublicPhone(contactHtml);
  const htmlLanguage = homepage.html.match(
    /<html[^>]+lang=["']([^"']+)["']/iu,
  )?.[1];
  const alternateLanguages = [
    ...new Set(
      [
        ...homepage.html.matchAll(
          /<link[^>]+hreflang=["']([^"']+)["'][^>]*>/giu,
        ),
      ]
        .map((entry) => entry[1]?.trim())
        .filter((value): value is string =>
          Boolean(value && value !== 'x-default'),
        ),
    ),
  ];
  return {
    sourceUrl: homepage.url,
    title: decodeHtmlText(
      homepage.html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? '',
    ).slice(0, 200),
    textExcerpt: decodeHtmlText(homepage.html).slice(0, 2_000),
    contactTextExcerpt: decodeHtmlText(contactHtml).slice(0, 1_000),
    ...(htmlLanguage ? { htmlLanguage } : {}),
    alternateLanguages,
    hasContactPage: Boolean(contact),
    hasPrivacyPage: privacy,
    hasMobileViewport: /<meta[^>]+name=["']viewport["']/iu.test(homepage.html),
    hasDescription: /<meta[^>]+name=["']description["']/iu.test(homepage.html),
    ...(foundEmail ? { foundEmail, emailSourceUrl } : {}),
    ...(foundPhone ? { foundPhone, phoneSourceUrl: emailSourceUrl } : {}),
  };
};

export type AuditScore = {
  total: number;
  fit: number;
  need: number;
  contactability: number;
  evidence: number;
};

export const scoreAuditDetailed = (
  audit: SiteAudit,
  context: { explicitDiscoveryMatch?: boolean; aresExactMatch?: boolean } = {},
): AuditScore => {
  const fit = context.explicitDiscoveryMatch ? 25 : 15;
  const need = Math.min(
    30,
    (audit.hasMobileViewport ? 0 : 10) +
      (audit.hasDescription ? 0 : 8) +
      (audit.hasContactPage ? 0 : 7) +
      (audit.hasPrivacyPage ? 0 : 5),
  );
  const contactability =
    (audit.foundPhone ? 12 : 0) + (audit.foundEmail ? 8 : 0);
  const evidence =
    5 +
    (audit.emailSourceUrl || audit.phoneSourceUrl ? 5 : 0) +
    (context.aresExactMatch ? 5 : 0);
  return {
    total: Math.min(100, fit + need + contactability + evidence),
    fit,
    need,
    contactability,
    evidence,
  };
};

export const scoreAudit = (
  audit: SiteAudit,
  context?: Parameters<typeof scoreAuditDetailed>[1],
): number => scoreAuditDetailed(audit, context).total;

export const draftOutreach = (
  companyName: string,
  offer: string,
  audit: SiteAudit,
  subjectTemplate: string,
  bodyTemplate: string,
) => {
  const observation = !audit.hasMobileViewport
    ? 'I could not find a mobile viewport declaration on your homepage.'
    : !audit.hasDescription
      ? 'I could not find a search description on your homepage.'
      : 'I reviewed your public website.';
  const replace = (template: string) =>
    template
      .replaceAll('{{company}}', companyName)
      .replaceAll('{{offer}}', offer)
      .replaceAll('{{observation}}', observation);
  return { subject: replace(subjectTemplate), body: replace(bodyTemplate) };
};

export class QuicklyClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}
  public async enroll(
    campaignId: number,
    lead: { email: string; companyName: string; subject: string; body: string },
  ): Promise<number | undefined> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/u, '')}/api/campaigns/${campaignId}/leads?skip_duplicates=true&verify_emails=false`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          {
            email: lead.email,
            name: lead.companyName,
            custom_data: { subject: lead.subject, body: lead.body },
          },
        ]),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok)
      throw new Error(`Quickly enrollment HTTP ${response.status}`);
    const result = z
      .object({
        ok: z.boolean(),
        results: z
          .array(
            z.object({
              status: z.string(),
              lead_id: z.number().int().optional(),
            }),
          )
          .optional(),
      })
      .parse(await response.json());
    if (
      !result.ok ||
      !['added', 'already_enrolled'].includes(result.results?.[0]?.status ?? '')
    )
      throw new Error('Quickly did not confirm enrollment');
    return result.results?.[0]?.lead_id;
  }
}
