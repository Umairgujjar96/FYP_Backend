// paymentTransactionController.js

import { validationResult } from "express-validator";
// const { default: PaymentTransaction } = require("../models/PaymentTransaction");

import PaymentTransaction from "../models/PaymentTransaction.js";
import User from "../models/User.js";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

/**
 * Create new payment transaction
 * @route POST /api/payments
 * @access Private - User
 */
export const createPayment = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }

  try {
    const { planId, paymentMethod, transactionId } = req.body;
    const userId = req.user.id; // Assuming user ID is in request after auth middleware

    // Verify the plan exists
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Create new payment transaction
    const payment = new PaymentTransaction({
      user: userId,
      plan: planId,
      amount: plan.price,
      paymentMethod,
      transactionId,
      status: transactionId ? "completed" : "pending", // If transactionId is provided, mark as completed
    });

    const savedPayment = await payment.save();

    // If payment is completed, update user subscription
    if (savedPayment.status === "completed") {
      await updateUserSubscription(userId, planId, plan);
    }

    res.status(201).json({
      success: true,
      message: "Payment transaction created successfully",
      data: savedPayment,
    });
  } catch (error) {
    console.error("Error creating payment transaction:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get all payment transactions for admin
 * @route GET /api/payments
 * @access Admin only
 */
export const getAllPayments = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const totalDocs = await PaymentTransaction.countDocuments();
    const payments = await PaymentTransaction.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "firstName lastName email")
      .populate("plan", "name price duration");

    res.status(200).json({
      success: true,
      count: payments.length,
      totalPages: Math.ceil(totalDocs / limit),
      currentPage: page,
      data: payments,
    });
  } catch (error) {
    console.error("Error fetching payment transactions:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get payment transactions for current user
 * @route GET /api/payments/user
 * @access Private - User
 */
export const getUserPayments = async (req, res) => {
  try {
    const userId = req.user.id; // Assuming user ID is in request after auth middleware

    const payments = await PaymentTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("plan", "name price duration");

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    console.error("Error fetching user payment transactions:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get payment transaction by ID
 * @route GET /api/payments/:id
 * @access Private - Admin or Owner of payment
 */
export const getPaymentById = async (req, res) => {
  try {
    const payment = await PaymentTransaction.findById(req.params.id)
      .populate("user", "firstName lastName email")
      .populate("plan", "name price duration");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment transaction not found",
      });
    }

    // Check if user is admin or payment owner
    if (
      req.user.role !== "admin" &&
      payment.user._id.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this payment",
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error("Error fetching payment transaction:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Update payment status and process subscription
 * @route PATCH /api/payments/:id/status
 * @access Admin only
 */
export const updatePaymentStatus = async (req, res) => {
  try {
    const { status, transactionId } = req.body;

    if (!["pending", "completed", "failed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const payment = await PaymentTransaction.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment transaction not found",
      });
    }

    // Don't allow changing completed payments back to pending
    if (payment.status === "completed" && status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot change status of completed payment",
      });
    }

    // Update payment
    const updateData = { status };
    if (transactionId) {
      updateData.transactionId = transactionId;
    }

    const updatedPayment = await PaymentTransaction.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    // If status changed to completed, update user subscription
    if (
      payment.status !== "completed" &&
      updatedPayment.status === "completed"
    ) {
      const plan = await SubscriptionPlan.findById(payment.plan);
      await updateUserSubscription(payment.user, payment.plan, plan);
    }

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      data: updatedPayment,
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get payment statistics
 * @route GET /api/payments/stats
 * @access Admin only
 */
export const getPaymentStats = async (req, res) => {
  try {
    const currentDate = new Date();
    const lastMonth = new Date(
      currentDate.setMonth(currentDate.getMonth() - 1)
    );

    // Total payments
    const totalPayments = await PaymentTransaction.countDocuments({
      status: "completed",
    });

    // Total revenue
    const revenueResult = await PaymentTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    // Monthly payments
    const monthlyPayments = await PaymentTransaction.aggregate([
      { $match: { status: "completed", createdAt: { $gte: lastMonth } } },
      {
        $group: {
          _id: { $month: "$createdAt" },
          count: { $sum: 1 },
          revenue: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Payment methods distribution
    const paymentMethods = await PaymentTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: "$paymentMethod", count: { $sum: 1 } } },
    ]);

    // Popular plans
    const popularPlans = await PaymentTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: "$plan", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "subscriptionplans",
          localField: "_id",
          foreignField: "_id",
          as: "planInfo",
        },
      },
      { $unwind: "$planInfo" },
      {
        $project: {
          planName: "$planInfo.name",
          count: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalPayments,
        totalRevenue,
        monthlyPayments,
        paymentMethods,
        popularPlans,
      },
    });
  } catch (error) {
    console.error("Error fetching payment statistics:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Helper function to update user subscription
 * @param {string} userId - User ID
 * @param {string} planId - Plan ID
 * @param {Object} plan - Plan object
 */
async function updateUserSubscription(userId, planId, plan) {
  try {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // Calculate subscription end date
    const currentDate = new Date();
    const endDate = new Date(currentDate);
    endDate.setDate(endDate.getDate() + plan.duration);

    // Update user subscription
    user.subscription = {
      status: "active",
      currentPlan:
        plan.name === "free"
          ? "free"
          : plan.name.includes("premium")
          ? "premium"
          : "basic",
      lastPayment: currentDate,
      nextPayment: endDate,
    };

    // If user was on trial, end it
    if (user.subscription.status === "trial") {
      user.subscription.trialEnd = currentDate;
    }

    await user.save();

    return user;
  } catch (error) {
    console.error("Error updating user subscription:", error);
    throw error;
  }
}
