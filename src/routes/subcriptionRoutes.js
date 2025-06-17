import express from "express";
import { body, param } from "express-validator";
// import * as subscriptionPlanController from "../controllers/subscriptionPlanController";
// import auth from "../middleware/auth";
import roleCheck from "../middleware/roleCheck.js";
import { auth } from "../middleware/authMiddleware.js";
// import { checkRole } from "../middleware/roleCheck";
import {
  activatePlan,
  createPlan,
  deletePlan,
  getAllPlans,
  getAllPlansAdmin,
  getPlanById,
  updatePlan,
} from "../controllers/subcriptionController.js";
const subcriptionRouter = express.Router();

// Validation middleware for subscription plans
const planValidation = [
  body("name").trim().notEmpty().withMessage("Plan name is required"),
  body("price")
    .isNumeric()
    .withMessage("Price must be a number")
    .isFloat({ min: 0 })
    .withMessage("Price must be greater than or equal to 0"),
  body("duration")
    .isInt({ min: 1 })
    .withMessage("Duration must be a positive integer"),
  body("features")
    .optional()
    .isArray()
    .withMessage("Features must be an array"),
];

// Get all active subscription plans
subcriptionRouter.get("/", auth, getAllPlans);

// Get all subscription plans (including inactive) - Admin only
subcriptionRouter.get("/all", auth, roleCheck(["admin"]), getAllPlansAdmin);

// Get subscription plan by ID
subcriptionRouter.get(
  "/:id",
  auth,
  [param("id").isMongoId().withMessage("Invalid plan ID")],
  getPlanById
);

// Create new subscription plan - Admin only
subcriptionRouter.post(
  "/",
  auth,
  // roleCheck(["admin"]),
  planValidation,
  createPlan
);

// Update subscription plan - Admin only
subcriptionRouter.put(
  "/:id",
  auth,
  // roleCheck(["admin"]),
  [
    param("id").isMongoId().withMessage("Invalid plan ID"),
    ...planValidation.map((validation) => validation.optional()),
  ],
  updatePlan
);

// Delete (deactivate) subscription plan - Admin only
subcriptionRouter.delete(
  "/:id",
  auth,
  roleCheck(["admin"]),
  [param("id").isMongoId().withMessage("Invalid plan ID")],
  deletePlan
);

// Reactivate subscription plan - Admin only
subcriptionRouter.patch(
  "/:id/activate",
  auth,
  roleCheck(["admin"]),
  [param("id").isMongoId().withMessage("Invalid plan ID")],
  activatePlan
);

export default subcriptionRouter;
