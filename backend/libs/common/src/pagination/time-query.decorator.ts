import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';
import { parseTimeInput } from '../utils/time';

export function TimeQueryParam(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }: { value: unknown }) => {
      const parsed = parseTimeInput(value);
      return parsed === null ? value : parsed;
    }),
    IsDate({ message: ({ property }) => `${property} must be an ISO-8601 date or epoch milliseconds` }),
  );
}
