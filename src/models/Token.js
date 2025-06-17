import mongoose from "mongoose";
const Schema = mongoose.Schema;

const tokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["refresh", "reset"],
      required: true,
    },
    userAgent: String,
    lastUsed: {
      type: Date,
      default: Date.now,
    },
    expiresAt: Date,
  },
  { timestamps: true }
);

// Index for quick lookups and automatic deletion
tokenSchema.index({ user: 1, type: 1 });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// module.exports = mongoose.model('Token', tokenSchema);
export default mongoose.model("Token", tokenSchema);
