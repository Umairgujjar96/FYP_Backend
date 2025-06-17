import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Payment Transaction Schema
const paymentTransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    plan: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "mobileBanking", "bankTransfer"],
      required: true,
    },
    transactionId: String,
  },
  { timestamps: true }
);

export default mongoose.model("PaymentTransaction", paymentTransactionSchema);
