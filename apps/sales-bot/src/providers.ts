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
  hasContactPage: boolean;
  hasPrivacyPage: boolean;
  hasMobileViewport: boolean;
  hasDescription: boolean;
  foundEmail?: string;
  emailSourceUrl?: string;
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
  return {
    sourceUrl: homepage.url,
    title: decodeHtmlText(
      homepage.html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? '',
    ).slice(0, 200),
    textExcerpt: decodeHtmlText(homepage.html).slice(0, 2_000),
    hasContactPage: Boolean(contact),
    hasPrivacyPage: privacy,
    hasMobileViewport: /<meta[^>]+name=["']viewport["']/iu.test(homepage.html),
    hasDescription: /<meta[^>]+name=["']description["']/iu.test(homepage.html),
    ...(foundEmail ? { foundEmail, emailSourceUrl } : {}),
  };
};

export const scoreAudit = (audit: SiteAudit): number => {
  let score = 40;
  if (!audit.hasMobileViewport) score += 20;
  if (!audit.hasDescription) score += 15;
  if (!audit.hasContactPage) score += 10;
  if (audit.foundEmail) score += 10;
  if (!audit.hasPrivacyPage) score += 5;
  return Math.min(100, score);
};

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

export class TwentyClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}
  public async createCompany(
    name: string,
    websiteUrl: string,
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/u, '')}/rest/companies`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name,
          domainName: { primaryLinkUrl: websiteUrl, additionalLinks: [] },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(`Twenty company HTTP ${response.status}`);
    const result = z
      .object({
        data: z
          .object({
            createCompany: z.object({ id: z.string() }).optional(),
            company: z.object({ id: z.string() }).optional(),
          })
          .optional(),
        id: z.string().optional(),
      })
      .parse(await response.json());
    const id =
      result.data?.createCompany?.id ?? result.data?.company?.id ?? result.id;
    if (!id) throw new Error('Twenty company response has no ID');
    return id;
  }
}
