import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

export interface FaqDoc {
  _id: Types.ObjectId;
  question: string;
  answer: string;
  /** Extra words customers use for this question (synonyms, Arabic terms). */
  keywords: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const faqSchema = new Schema<FaqDoc>(
  {
    question: { type: String, required: true, trim: true, minlength: 3, maxlength: 300 },
    answer: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    keywords: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
      default: [],
      validate: { validator: (value: string[]) => value.length <= 30, message: "At most 30 keywords" },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

faqSchema.index({ active: 1, updatedAt: -1 });

export const Faq = defineModel<FaqDoc>("Faq", faqSchema);
