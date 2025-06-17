import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Subscription Plan Schema
const subscriptionPlanSchema = new Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    duration: { type: Number, required: true },
    features: [{ name: String, description: String, isIncluded: Boolean }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
