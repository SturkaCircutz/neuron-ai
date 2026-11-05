import type { z } from 'zod';
import { HttpError } from './errors.js';

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
    throw new HttpError(400, 'validation_failed', message);
  }
  return result.data;
}
