import { z } from 'zod';

const packageIdentitySchema = z.object({
  ecosystem: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  purl: z.string().trim().min(1).max(1_000).optional(),
});

const technologyWatchEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u),
    ecosystem: z.string().trim().min(1).max(100),
    vendor: z.string().trim().min(1).max(200),
    project: z.string().trim().min(1).max(200),
    package: packageIdentitySchema.optional(),
    cpe: z.string().startsWith('cpe:2.3:').max(1_000).optional(),
    versions: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    officialAdvisorySources: z.array(z.url()).min(1).max(20),
    matchingStrategy: z.enum(['OSV_PACKAGE', 'NVD_CPE', 'OFFICIAL_PROVIDER']),
    deploymentResponsibility: z.enum(['PATCHABLE', 'PROVIDER_MANAGED']),
    enabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.matchingStrategy === 'OSV_PACKAGE' && !value.package) {
      context.addIssue({
        code: 'custom',
        path: ['package'],
        message: 'OSV_PACKAGE matching requires a structured package identity',
      });
    }
    if (value.matchingStrategy === 'NVD_CPE' && !value.cpe) {
      context.addIssue({
        code: 'custom',
        path: ['cpe'],
        message: 'NVD_CPE matching requires a CPE 2.3 identity',
      });
    }
    if (
      value.matchingStrategy === 'OFFICIAL_PROVIDER' &&
      value.deploymentResponsibility !== 'PROVIDER_MANAGED'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['deploymentResponsibility'],
        message: 'Official provider status sources are provider-managed only',
      });
    }
  });

const watchlistSchema = z
  .array(technologyWatchEntrySchema)
  .max(200)
  .superRefine((entries, context) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'Technology identifiers must be unique',
        });
      }
      seen.add(entry.id);
    });
  });

export type TechnologyWatchEntry = z.infer<typeof technologyWatchEntrySchema>;

export const parseTechnologyWatchlist = (
  value: unknown,
): TechnologyWatchEntry[] => watchlistSchema.parse(value);
