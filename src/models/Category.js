import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Product Category Schema
const categorySchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    name: { type: String, required: true },
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export default mongoose.model("Category", categorySchema);
