import mongoose from "mongoose";
const Schema = mongoose.Schema;

const batchSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    batchNumber: { type: String, required: true },
    manufacturingDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    costPrice: { type: Number, required: true },
    sellingPrice: { type: Number, required: true },
    currentStock: { type: Number, required: true },
    initialStock: { type: Number, required: true },
    supplier: { type: Schema.Types.ObjectId, ref: "Supplier" },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// ✅ Define indexes properly
batchSchema.index({ batchNumber: 1, store: 1 }, { unique: true });

export default mongoose.model("Batch", batchSchema);
