import mongoose, { Schema } from "mongoose";
import { describe, expect, it } from "vitest";

// Importing the module applies the global Mongoose settings under test.
import "@/lib/db/mongoose";

const Probe = mongoose.model("Probe", new Schema({ conversationId: String, runAt: Date }));

describe("global mongoose settings", () => {
  it("throws on filter paths that are not in the schema instead of dropping them", () => {
    // Built at runtime, as a filter assembled from request data would be (bypasses compile-time checks).
    const typoFilter: Record<string, unknown> = { conversationID: "abc" };
    expect(() => { Probe.find(typoFilter).cast(); }).toThrow(/not in schema/i);
  });

  it("leaves server-side query operators intact", () => {
    const now = new Date();
    const filter = Probe.find({ runAt: { $lte: now } }).cast() as { runAt: { $lte: Date } };
    expect(filter.runAt.$lte).toEqual(now);
  });
});
