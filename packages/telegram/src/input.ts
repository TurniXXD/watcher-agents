import { z } from 'zod';

export const stockSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/);

export const publicationQuerySchema = z.string().trim().min(2).max(200);

export const commandArgument = (text: string | undefined): string =>
  (text ?? '').trim().split(/\s+/).slice(1).join(' ');
