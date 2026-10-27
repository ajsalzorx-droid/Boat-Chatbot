/**
 * Creates the indexes declared on every registered model.
 *
 * Usage: npm run db:sync-indexes
 *
 * Uses `createIndexes` (additive) rather than `syncIndexes`, so an index removed from code is
 * reported but never dropped automatically: dropping a unique index in production must be a
 * deliberate, reviewed operation.
 */
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/mongoose";
import { getRegisteredModels } from "@/models";

async function main(): Promise<void> {
  const models = getRegisteredModels();
  if (models.length === 0) {
    console.log("No models registered yet; nothing to index.");
    return;
  }

  await connectToDatabase();

  for (const model of models) {
    await model.createCollection();
    await model.createIndexes();
    const diff = await model.diffIndexes();
    console.log(
      JSON.stringify({ model: model.modelName, status: "indexed", extraIndexesInDatabase: diff.toDrop }),
    );
  }
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Index sync failed:", error instanceof Error ? error.message : "unknown error");
    await mongoose.disconnect();
    process.exitCode = 1;
  });
