// subscriptionPlanController.js

import { validationResult } from "express-validator";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

/**
 * Get all subscription plans
 * @route GET /api/subscription-plans
 * @access Admin only
 */
export const getAllPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true });
    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get subscription plan by ID
 * @route GET /api/subscription-plans/:id
 * @access Admin only
 */
export const getPlanById = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error("Error fetching subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Create new subscription plan
 * @route POST /api/subscription-plans
 * @access Admin only
 */
export const createPlan = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }

  try {
    const { name, price, duration, features } = req.body;

    // Create new plan
    const plan = new SubscriptionPlan({
      name,
      price,
      duration,
      features: features || [],
    });

    const savedPlan = await plan.save();

    res.status(201).json({
      success: true,
      message: "Subscription plan created successfully",
      data: savedPlan,
    });
  } catch (error) {
    console.error("Error creating subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Update subscription plan
 * @route PUT /api/subscription-plans/:id
 * @access Admin only
 */
export const updatePlan = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }

  try {
    const planId = req.params.id;
    const updateData = req.body;

    const plan = await SubscriptionPlan.findById(planId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(
      planId,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Subscription plan updated successfully",
      data: updatedPlan,
    });
  } catch (error) {
    console.error("Error updating subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Delete subscription plan (soft delete)
 * @route DELETE /api/subscription-plans/:id
 * @access Admin only
 */
export const deletePlan = async (req, res) => {
  try {
    const planId = req.params.id;

    const plan = await SubscriptionPlan.findById(planId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Soft delete - set isActive to false
    const deletedPlan = await SubscriptionPlan.findByIdAndUpdate(
      planId,
      { isActive: false },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Subscription plan deactivated successfully",
      data: deletedPlan,
    });
  } catch (error) {
    console.error("Error deleting subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get all subscription plans (including inactive plans)
 * @route GET /api/subscription-plans/all
 * @access Admin only
 */
export const getAllPlansAdmin = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find();
    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching all subscription plans:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Reactivate a subscription plan
 * @route PATCH /api/subscription-plans/:id/activate
 * @access Admin only
 */
export const activatePlan = async (req, res) => {
  try {
    const planId = req.params.id;

    const plan = await SubscriptionPlan.findById(planId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const activatedPlan = await SubscriptionPlan.findByIdAndUpdate(
      planId,
      { isActive: true },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Subscription plan activated successfully",
      data: activatedPlan,
    });
  } catch (error) {
    console.error("Error activating subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
