import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

export const PRODUCT_KINDS = ["product", "service"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const AVAILABILITY = ["available", "out_of_stock", "on_request", "discontinued"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export interface ProductDoc {
  _id: Types.ObjectId;
  kind: ProductKind;
  name: string;
  description: string;
  /** Null when the price is not published; the bot then never quotes one. */
  price: number | null;
  currency: string;
  availability: Availability;
  keywords: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductDoc>(
  {
    kind: { type: String, enum: PRODUCT_KINDS, default: "product" },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    price: { type: Number, min: 0, max: 100_000_000, default: null },
    currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: "AED" },
    availability: { type: String, enum: AVAILABILITY, default: "available" },
    keywords: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
      default: [],
      validate: { validator: (value: string[]) => value.length <= 30, message: "At most 30 keywords" },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.index({ active: 1, name: 1 });

export const Product = defineModel<ProductDoc>("Product", productSchema);
