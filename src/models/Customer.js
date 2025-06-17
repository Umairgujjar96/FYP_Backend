import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Customer Schema
const customerSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phoneNumber: String,
    prescriptions: [
      {
        file: String,
        uploadDate: { type: Date, default: Date.now },
        expiryDate: { type: Date, default: null },
        status: { type: String, enum: ["active", "expired", "used"] },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Customer", customerSchema);
