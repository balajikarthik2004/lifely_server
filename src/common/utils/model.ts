import type { SchemaOptions } from 'mongoose';

/**
 * Shared schema options.
 *
 * Every document serialises with `id` instead of `_id`, and without `__v`, so
 * the API shape matches the client's models exactly.
 */
export const baseSchemaOptions: SchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(_doc, ret: Record<string, unknown>) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.userId;
      return ret;
    },
  },
  toObject: { virtuals: true },
};

/** Subdocuments keep their id but never expose _id. */
export const subSchemaOptions: SchemaOptions = {
  _id: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(_doc, ret: Record<string, unknown>) {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
};
