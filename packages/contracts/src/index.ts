import { z } from 'zod';
export const fields = [
  'sku',
  'name',
  'description',
  'category',
  'price',
  'currency',
  'unit',
  'active',
] as const;
export type Field = (typeof fields)[number];
export const fieldLabels: Record<Field, string> = {
  sku: 'SKU',
  name: 'Product name',
  description: 'Description',
  category: 'Category',
  price: 'Unit price',
  currency: 'Currency',
  unit: 'Unit of measure',
  active: 'Active status',
};
export const configSchema = z
  .object({
    version: z.literal(1),
    mappings: z.record(z.string(), z.enum(fields)),
    trim: z.boolean(),
    numberFormat: z.enum(['plain', 'comma-grouped', 'dot-grouped']),
    blankPolicy: z.enum(['preserve', 'clear', 'error']),
    defaults: z.object({
      category: z.string().max(100).optional(),
      currency: z.string().max(8).optional(),
      unit: z.string().max(40).optional(),
      active: z.enum(['true', 'false']).optional(),
    }),
    categories: z.record(z.string(), z.string().max(100)),
    units: z.record(z.string(), z.string().max(40)),
    currencyToken: z.enum(['none', 'PHP', 'USD', 'EUR']),
    origin: z.enum(['manual', 'deterministic', 'provider', 'saved']).default('manual'),
  })
  .strict();
export type ImportConfig = z.infer<typeof configSchema>;
export const emptyConfig: ImportConfig = {
  version: 1,
  mappings: {},
  trim: true,
  numberFormat: 'plain',
  blankPolicy: 'preserve',
  defaults: {},
  categories: {},
  units: {},
  currencyToken: 'none',
  origin: 'manual',
};
export const exclusionsSchema = z.record(
  z.string().regex(/^\d+$/),
  z.string().trim().min(3).max(300),
);
export const prepareSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  config: configSchema,
  exclusions: exclusionsSchema,
});
export const commitSchema = z.object({
  revision: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(100),
});
export const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(200) });
export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(100),
  contact: z.string().max(200).default(''),
});
export const allowedSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  currencies: z
    .array(z.string().regex(/^[A-Z]{3}$/))
    .min(1)
    .max(30),
  units: z.array(z.string().trim().min(1).max(40)).min(1).max(100),
});
export type Allowed = z.infer<typeof allowedSchema>;
export type ProductValues = {
  sku: string;
  name: string;
  description: string | null;
  category: string;
  price: string;
  currency: string;
  unit: string;
  active: boolean;
};
export type Product = ProductValues & {
  id: string;
  version: number;
  original_sku: string;
  supplier_id: string;
  updated_at: string;
  supplier_name?: string;
};
export type Issue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  field?: string;
  original?: string;
  message: string;
};
export type PreviewRow = {
  record: number;
  source: string[];
  values: Partial<ProductValues>;
  kind: 'create' | 'update' | 'unchanged' | 'blocked' | 'excluded';
  issues: Issue[];
  reason?: string;
  productId?: string;
  expectedVersion?: number;
  changes: { field: string; before: unknown; after: unknown }[];
};
export type Counts = Record<PreviewRow['kind'], number>;
export type Preview = { revision: number; rows: PreviewRow[]; counts: Counts; preparedAt: string };
export const suggestionSchema = z
  .object({
    mappings: z.record(z.string(), z.enum(fields)),
    categories: z.record(z.string(), z.string()),
    units: z.record(z.string(), z.string()),
    reason: z.string().max(2000),
  })
  .strict();
export type Suggestion = z.infer<typeof suggestionSchema>;
