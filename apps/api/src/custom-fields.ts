import { z } from 'zod';
export const customFieldsInput = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(80),
      value: z.union([z.string().max(5000), z.number().finite()]),
    }),
  )
  .max(50)
  .refine((fields) => new Set(fields.map((field) => field.name)).size === fields.length, '自定义词条名称不能重复');
