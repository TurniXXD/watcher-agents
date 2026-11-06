import { z } from 'zod';

const cursorSchema = z.object({
  s: z.string().min(1).max(40),
  v: z.union([z.string().max(64), z.number(), z.null()]),
  id: z.string().min(1).max(64),
});
export type Cursor = z.infer<typeof cursorSchema>;

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/** Returns `null` for malformed cursors or cursors issued for another sort. */
export const decodeCursor = (value: string, sort: string): Cursor | null => {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (!parsed.success || parsed.data.s !== sort) return null;
    return parsed.data;
  } catch {
    return null;
  }
};
