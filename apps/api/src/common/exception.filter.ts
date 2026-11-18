import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@gunraid/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_ERROR',
  415: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const { status, body } = this.toResponse(exception);
    body.error.requestId = String(request.id);
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (exception instanceof AppError && status === 429) {
      const retry = (exception.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
      if (retry) void reply.header('Retry-After', Math.ceil(retry / 1000));
    }
    void reply.status(status).send(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: { error: { code: exception.code, details: exception.details } },
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', details: formatZodIssues(exception) } },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, body: { error: { code: STATUS_CODES[status] ?? 'INTERNAL' } } };
    }
    const maybe = exception as { statusCode?: number; code?: string } | null;
    if (maybe && typeof maybe.statusCode === 'number' && maybe.statusCode < 500) {
      // Ошибки Fastify (битый JSON, слишком большой body и т.п.)
      return {
        status: maybe.statusCode,
        body: { error: { code: STATUS_CODES[maybe.statusCode] ?? 'VALIDATION_ERROR' } },
      };
    }
    return { status: 500, body: { error: { code: 'INTERNAL' } } };
  }
}

export function formatZodIssues(
  error: ZodError,
): Array<{ path: string; code: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
}
