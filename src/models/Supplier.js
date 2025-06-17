import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Supplier Schema
const supplierSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    name: { type: String, required: true },
    contactPerson: String,
    email: { type: String, unique: true, sparse: true },
    phoneNumber: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Supplier", supplierSchema);
