import "server-only";

import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { Faq, type FaqDoc } from "@/models/faq";
import { Product, type ProductDoc } from "@/models/product";
import type { KnowledgeFaq, KnowledgeProduct } from "@/services/chatbot/types";

/** CRUD for the trusted knowledge the chatbot answers from: FAQs and products/services. */

export type FaqInput = Pick<FaqDoc, "question" | "answer" | "keywords" | "active">;
export type ProductInput = Pick<ProductDoc, "kind" | "name" | "description" | "price" | "currency" | "availability" | "keywords" | "offer" | "active">;

function notFound(what: string): AppError {
  return new AppError(`${what} not found`, { code: "NOT_FOUND", httpStatus: 404, publicMessage: `${what} not found.` });
}

export async function listFaqs(): Promise<FaqDoc[]> {
  await connectToDatabase();
  return Faq.find().sort({ updatedAt: -1 }).limit(1000).lean();
}

export async function createFaq(input: FaqInput): Promise<FaqDoc> {
  await connectToDatabase();
  const created = await Faq.create(input);
  return created.toObject();
}

export async function updateFaq(id: Types.ObjectId, input: Partial<FaqInput>): Promise<FaqDoc> {
  await connectToDatabase();
  const updated = await Faq.findByIdAndUpdate(id, { $set: input }, { returnDocument: "after", runValidators: true, lean: true });
  if (!updated) throw notFound("FAQ");
  return updated;
}

export async function deleteFaq(id: Types.ObjectId): Promise<void> {
  await connectToDatabase();
  const result = await Faq.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw notFound("FAQ");
}

export async function listProducts(): Promise<ProductDoc[]> {
  await connectToDatabase();
  return Product.find().sort({ name: 1 }).limit(2000).lean();
}

export async function createProduct(input: ProductInput): Promise<ProductDoc> {
  await connectToDatabase();
  const created = await Product.create(input);
  return created.toObject();
}

export async function updateProduct(id: Types.ObjectId, input: Partial<ProductInput>): Promise<ProductDoc> {
  await connectToDatabase();
  const updated = await Product.findByIdAndUpdate(id, { $set: input }, { returnDocument: "after", runValidators: true, lean: true });
  if (!updated) throw notFound("Product");
  return updated;
}

export async function deleteProduct(id: Types.ObjectId): Promise<void> {
  await connectToDatabase();
  const result = await Product.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw notFound("Product");
}

/** Active knowledge only, in the engine's plain format. */
export async function loadKnowledge(): Promise<{ faqs: KnowledgeFaq[]; products: KnowledgeProduct[] }> {
  await connectToDatabase();
  const [faqs, products] = await Promise.all([
    Faq.find({ active: true }).limit(500).lean(),
    Product.find({ active: true }).limit(1000).lean(),
  ]);
  return {
    faqs: faqs.map((faq) => ({ id: faq._id.toString(), question: faq.question, answer: faq.answer, keywords: faq.keywords })),
    products: products.map((product) => ({
      id: product._id.toString(),
      kind: product.kind,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      availability: product.availability,
      keywords: product.keywords,
      // Documents created before offers existed have no field.
      offer: product.offer ?? null,
    })),
  };
}
