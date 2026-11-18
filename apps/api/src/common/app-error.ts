import type { ErrorCode } from '@gunraid/shared';

/** Ошибка предметной области: код (i18n на фронте) + HTTP-статус + детали. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const notFound = (code: ErrorCode = 'NOT_FOUND', details?: unknown) =>
  new AppError(code, 404, details);
export const forbidden = (code: ErrorCode = 'FORBIDDEN', details?: unknown) =>
  new AppError(code, 403, details);
export const unauthorized = (code: ErrorCode = 'UNAUTHORIZED', details?: unknown) =>
  new AppError(code, 401, details);
export const conflict = (code: ErrorCode = 'CONFLICT', details?: unknown) =>
  new AppError(code, 409, details);
export const badRequest = (code: ErrorCode = 'VALIDATION_ERROR', details?: unknown) =>
  new AppError(code, 400, details);
