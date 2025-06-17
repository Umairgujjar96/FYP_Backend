import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Sale/Transaction Schema with Return Support
const saleSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer" },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        batch: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
        quantity: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        discount: { type: Number, default: 0 },
        subtotal: { type: Number, required: true },
        returnedQuantity: { type: Number, default: 0 }, // Track returned quantity
      },
    ],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    tax: { type: Number, required: true },
    total: { type: Number, required: true },
    returnTotal: { type: Number, default: 0 }, // Total amount returned/refunded
    finalTotal: { type: Number }, // Final total after returns (calculated)
    payment: {
      method: {
        type: String,
        enum: ["cash", "card", "mobileBanking"],
        required: true,
      },
      status: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "pending",
      },
      transactionId: String,
    },
    staffMember: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Track return history
    returns: [
      {
        date: { type: Date, default: Date.now },
        items: [
          {
            product: {
              type: Schema.Types.ObjectId,
              ref: "Product",
              required: true,
            },
            batch: {
              type: Schema.Types.ObjectId,
              ref: "Batch",
              required: true,
            },
            quantity: { type: Number, required: true },
          },
        ],
        reason: { type: String },
        processedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        refundAmount: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true }
);

// Virtual to calculate remaining items (not returned)
saleSchema.virtual("remainingItems").get(function () {
  return this.items.map((item) => ({
    ...item,
    remainingQuantity: item.quantity - (item.returnedQuantity || 0),
  }));
});

// Pre-save hook to calculate finalTotal if not set
saleSchema.pre("save", function (next) {
  if (this.isModified("returnTotal") || !this.finalTotal) {
    this.finalTotal = this.total - (this.returnTotal || 0);
  }
  next();
});

export default mongoose.model("Sale", saleSchema);
