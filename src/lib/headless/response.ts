import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { resolveHeadlessActor } from '@/lib/thesis-service/actor';
import type { ThesisActor } from '@/lib/thesis-service/actor';
import { getErrorResponse, ThesisServiceError } from '@/lib/thesis-service/errors';
import type { ThesisScope } from '@/lib/thesis-service/scopes';
import {
  checkHeadlessRateLimit,
  completeIdempotencyKey,
  getIdempotentResponse,
  hashPayload,
  HEADLESS_LIMITS,
  reserveIdempotencyKey,
} from '@/lib/thesis-service/safety';

export type HeadlessHandler<T> = (actor: ThesisActor) => Promise<T>;

export function headlessOk<T>(data: T, status = 200) {
  return Response.json({ data, error: null }, { status });
}

export function headlessError(err: unknown) {
  const error = getErrorResponse(err);
  return Response.json(
    {
      data: null,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    },
    { status: error.status },
  );
}

export async function withHeadlessActor<T>(
  request: Request,
  requiredScopes: ThesisScope | ThesisScope[],
  handler: HeadlessHandler<T>,
) {
  try {
    const actor = await resolveHeadlessActor(request, requiredScopes);
    checkHeadlessRateLimit(actor);
    return headlessOk(await handler(actor));
  } catch (err) {
    return headlessError(err);
  }
}

export async function readJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > HEADLESS_LIMITS.maxJsonBodyBytes) {
    throw new ThesisServiceError('payload_too_large', 'Request body is too large', 413, {
      limitBytes: HEADLESS_LIMITS.maxJsonBodyBytes,
    });
  }

  const parsedJson = raw.trim() ? JSON.parse(raw) : {};
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ThesisServiceError('validation_error', parsed.error.message, 400, parsed.error.flatten());
  }

  return parsed.data;
}

export async function withHeadlessJson<TSchema extends z.ZodType, TData>(
  request: Request,
  requiredScopes: ThesisScope | ThesisScope[],
  schema: TSchema,
  handler: (actor: ThesisActor, body: z.infer<TSchema>) => Promise<TData>,
  options: { idempotent?: boolean } = {},
) {
  try {
    const actor = await resolveHeadlessActor(request, requiredScopes);
    checkHeadlessRateLimit(actor);
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > HEADLESS_LIMITS.maxJsonBodyBytes) {
      throw new ThesisServiceError('payload_too_large', 'Request body is too large', 413, {
        limitBytes: HEADLESS_LIMITS.maxJsonBodyBytes,
      });
    }

    const json = raw.trim() ? JSON.parse(raw) : {};
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ThesisServiceError(
        'validation_error',
        parsed.error.message,
        400,
        parsed.error.flatten(),
      );
    }

    const supabase = createServerClient();
    const idempotencyKey = options.idempotent ? request.headers.get('idempotency-key') : null;
    const requestHash = hashPayload(parsed.data);
    const replay = await getIdempotentResponse(supabase, {
      actor,
      key: idempotencyKey,
      method: request.method,
      path: new URL(request.url).pathname,
      requestHash,
    });
    if (replay) {
      return Response.json(replay.body, { status: replay.status });
    }

    await reserveIdempotencyKey(supabase, {
      actor,
      key: idempotencyKey,
      method: request.method,
      path: new URL(request.url).pathname,
      requestHash,
    });

    const responseBody = { data: await handler(actor, parsed.data), error: null };
    await completeIdempotencyKey(supabase, {
      actor,
      key: idempotencyKey,
      status: 200,
      body: responseBody,
    });
    return Response.json(responseBody, { status: 200 });
  } catch (err) {
    return headlessError(err);
  }
}
