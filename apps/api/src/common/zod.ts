import { Body, Param, Query, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './app-error.js';
import { formatZodIssues } from './exception.filter.js';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppError('VALIDATION_ERROR', 400, formatZodIssues(result.error));
    }
    return result.data;
  }
}

export const ZBody = <T>(schema: ZodType<T>) => Body(new ZodPipe(schema));
export const ZQuery = <T>(schema: ZodType<T>) => Query(new ZodPipe(schema));
export const ZParam = <T>(name: string, schema: ZodType<T>) => Param(name, new ZodPipe(schema));
