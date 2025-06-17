import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Medicine List Schema
const medicineListSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    name: { type: String, required: true },
    description: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
    notes: { type: String },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    targetDate: { type: Date },
    status: {
      type: String,
      enum: ["draft", "pending", "completed", "cancelled"],
      default: "draft",
    },
  },
  { timestamps: true }
);

// Medicine Schema
const medicineSchema = new Schema(
  {
    medicineList: {
      type: Schema.Types.ObjectId,
      ref: "MedicineList",
      required: true,
    },
    name: { type: String, required: true },
    company: { type: String },
    dosage: { type: String },
    quantity: { type: Number, default: 1 },
    packSize: { type: String },
    price: { type: Number },
    category: { type: String },
    expiryDate: { type: Date },
    prescriptionRequired: { type: Boolean, default: false },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Create models
const MedicineList = mongoose.model("MedicineList", medicineListSchema);
const Medicine = mongoose.model("Medicine", medicineSchema);

export { MedicineList, Medicine };
