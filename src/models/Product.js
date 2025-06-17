import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Product Schema
const productSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    category: { type: Schema.Types.ObjectId, ref: "Category" },
    name: { type: String, required: true },
    genericName: String,
    description: String,
    manufacturer: String,
    requiresPrescription: { type: Boolean, default: false },
    dosageForm: String,
    strength: String,
    barcode: { type: String, unique: true, sparse: true },
    image: String,
    minStockLevel: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Product", productSchema);
