// zod schemas for data crossing the IPC boundary (validated in the main process) and for files read from disk.
import { z } from 'zod';

export const FetchSpecSchema = z.object({
  url: z.string().min(1).max(4096),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string(), z.string().max(1024)).optional(),
  body: z.string().max(1_000_000).optional(),
  priority: z.enum(['user', 'prefetch']).optional(),
});

export const RequestIdSchema = z.string().min(1).max(100);

export const SaveFileSpecSchema = z.object({
  suggestedName: z.string().min(1).max(200),
  data: z.string().max(100_000_000),
  encoding: z.enum(['utf8', 'base64']),
  filters: z
    .array(z.object({ name: z.string().max(100), extensions: z.array(z.string().max(10)).max(10) }))
    .max(10),
});

/** One cache entry as stored on disk (JSON file). `bodyHash` lets us detect corruption. */
export const CacheEntrySchema = z.object({
  key: z.string(),
  url: z.string(),
  storedAt: z.number(),
  ttlMs: z.number(),
  bytes: z.number(),
  bodyHash: z.string(),
  body: z.string(),
});
export type CacheEntry = z.infer<typeof CacheEntrySchema>;

/** Remembered window position/size. */
export const WindowStateSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(400),
  height: z.number().min(300),
  maximized: z.boolean().optional(),
});
export type WindowState = z.infer<typeof WindowStateSchema>;
