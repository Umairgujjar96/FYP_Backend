import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Store Schema
const storeSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    registrationNumber: { type: String, required: true, unique: true },
    licenseNumber: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    operatingHours: {
      open: String,
      close: String,
      holidays: [String],
    },
    staff: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Store", storeSchema);
