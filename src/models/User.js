import mongoose from "mongoose";
const Schema = mongoose.Schema;

// User Schema
const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      match: [/\S+@\S+\.\S+/, "Invalid email format"], // Email validation
    },
    password: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true, trim: true },
    role: {
      type: String,
      enum: ["admin", "owner", "staff"],
      default: "owner",
    },
    subscription: {
      status: {
        type: String,
        enum: ["trial", "active", "expired"],
        default: "trial",
      },
      trialStart: { type: Date, default: Date.now },
      trialEnd: { type: Date, default: null },
      currentPlan: {
        type: String,
        enum: ["free", "basic", "premium"],
        default: "free",
      },
      lastPayment: { type: Date, default: null },
      nextPayment: { type: Date, default: null },
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      zipCode: { type: String, trim: true },
      country: { type: String, trim: true },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
