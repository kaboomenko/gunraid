import { Body, Param, Query, type PipeTransform } from '@nestjs/common';
import { hasUnsafeText } from '@gunraid/shared';
import type { ZodType } from 'zod';
import { AppError } from './app-error.js';
import { formatZodIssues } from './exception.filter.js';

const isPlainObject = (v: object): v is Record<string, unknown> => {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * Пути строк (и ключей объектов) с NUL или половиной суррогатной пары (hasUnsafeText) в разобранном значении —
 * не больше `limit`. Обход без рекурсии: глубина JSON на входе ничем не ограничена.
 */
export function unsafeTextPaths(value: unknown, limit = 20): string[] {
  const found: string[] = [];
  const stack: Array<[unknown, string]> = [[value, '']];
  const join = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));
  while (stack.length && found.length < limit) {
    const [v, path] = stack.pop()!;
    if (typeof v === 'string') {
      if (hasUnsafeText(v)) found.push(path);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], join(path, i)]);
    } else if (v !== null && typeof v === 'object' && isPlainObject(v)) {
      for (const [k, item] of Object.entries(v).reverse()) {
        if (hasUnsafeText(k)) found.push(join(path, k));
        else stack.push([item, join(path, k)]);
      }
    }
  }
  return found.slice(0, limit);
}

/**
 * Разбор тела, запроса и параметров адреса схемой zod → 400 VALIDATION_ERROR с массивом ошибок. Сверх схемы —
 * строки с NUL и одиночными суррогатами (во всех ручках сразу): PostgreSQL их не сохранит, без этой проверки запись
 * падала бы 500, а в text одиночный суррогат молча превращался бы в «�».
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppError('VALIDATION_ERROR', 400, formatZodIssues(result.error));
    }
    const unsafe = unsafeTextPaths(result.data);
    if (unsafe.length) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        unsafe.map((path) => ({
          path,
          code: 'invalid_text',
          message: 'NUL or unpaired surrogate in text',
        })),
      );
    }
    return result.data;
  }
}

export const ZBody = <T>(schema: ZodType<T>) => Body(new ZodPipe(schema));
export const ZQuery = <T>(schema: ZodType<T>) => Query(new ZodPipe(schema));
export const ZParam = <T>(name: string, schema: ZodType<T>) => Param(name, new ZodPipe(schema));
