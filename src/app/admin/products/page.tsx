import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { ProductsClient } from "./products-client";

export const metadata: Metadata = { title: "Products & services" };

export default async function ProductsPage() {
  await requirePageSession("admin");
  return <ProductsClient />;
}
