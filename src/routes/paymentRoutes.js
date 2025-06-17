import express from "express";
import { body } from "express-validator";

import adminMiddleware from "../middleware/adminMiddleware.js";
import { auth } from "../middleware/authMiddleware.js";
import {
  createPayment,
  getAllPayments,
  getPaymentById,
  getPaymentStats,
  getUserPayments,
  updatePaymentStatus,
} from "../controllers/paymentController.js";

const paymentRouter = express.Router();

// Validation middleware
const paymentValidation = [
  body("planId").notEmpty().withMessage("Subscription plan ID is required"),
  body("paymentMethod").notEmpty().withMessage("Payment method is required"),
  body("transactionId").optional().isString(),
];

const statusValidation = [
  body("status")
    .isIn(["pending", "completed", "failed"])
    .withMessage("Invalid status value"),
  body("transactionId").optional().isString(),
];

// Create new payment transaction
paymentRouter.post("/payments", auth, paymentValidation, createPayment);

// Get all payments (admin only)
paymentRouter.get("/payments", auth, adminMiddleware, getAllPayments);

// Get current user's payments
paymentRouter.get("/payments/user", auth, getUserPayments);

// Get payment statistics (admin only)
paymentRouter.get("/payments/stats", auth, adminMiddleware, getPaymentStats);

// Get payment by ID
paymentRouter.get("/payments/:id", auth, getPaymentById);

// Update payment status (admin only)
paymentRouter.patch(
  "/payments/:id/status",
  auth,
  adminMiddleware,
  statusValidation,
  updatePaymentStatus
);

export default paymentRouter;
