import express from "express";
import { body, query, param } from "express-validator";
// import StoreController from '../controllers/StoreController';
// import auth from "../middleware/auth";
// import { checkRole } from "../middleware/roleCheck";
import StoreController from "../controllers/storeController.js";
import roleCheck from "../middleware/roleCheck.js";
import { auth } from "../middleware/authMiddleware.js";

const storeRouter = express.Router();
const storeController = new StoreController();

// Validation middleware for store creation and updates
const storeValidation = [
  body("name").trim().notEmpty().withMessage("Store name is required"),
  body("email").isEmail().withMessage("Valid email is required"),
  body("phoneNumber").notEmpty().withMessage("Phone number is required"),
  body("registrationNumber")
    .notEmpty()
    .withMessage("Registration number is required"),
  body("licenseNumber").notEmpty().withMessage("License number is required"),
  body("address").isObject().withMessage("Address must be an object"),
  body("address.street").notEmpty().withMessage("Street address is required"),
  body("address.city").notEmpty().withMessage("City is required"),
  body("address.state").notEmpty().withMessage("State is required"),
  body("address.zipCode").notEmpty().withMessage("Postal code is required"),
];

// Operating hours validation
const operatingHoursValidation = [
  body("open")
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .withMessage("Opening time must be in HH:MM format"),
  body("close")
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .withMessage("Closing time must be in HH:MM format"),
  body("holidays")
    .isArray()
    .optional()
    .withMessage("Holidays must be an array of dates"),
];

// Create store (Owner/Admin only)
storeRouter.post(
  "/",
  auth,
  roleCheck(["owner", "admin"]),
  storeValidation,
  storeController.createStore
);

// Get all stores with filters and pagination
storeRouter.get(
  "/",
  auth,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("isActive").optional().isBoolean(),
    query("owner").optional().isMongoId(),
    query("name").optional().trim(),
    query("city").optional().trim(),
    query("state").optional().trim(),
  ],
  storeController.getAllStores
);

// Get store by ID
storeRouter.get(
  "/:id",
  auth,
  [param("id").isMongoId()],
  storeController.getStoreById
);

// Update store (Owner/Admin only)
storeRouter.put(
  "/:id",
  auth,
  // roleCheck(["owner", "admin"]),
  [param("id").isMongoId(), ...storeValidation],
  storeController.updateStore
);

// Deactivate store (Owner/Admin only)
storeRouter.patch(
  "/:id/deactivate",
  auth,
  roleCheck(["owner", "admin"]),
  [param("id").isMongoId()],
  storeController.deactivateStore
);

// Reactivate store (Owner/Admin only)
storeRouter.patch(
  "/:id/reactivate",
  auth,
  roleCheck(["owner", "admin"]),
  [param("id").isMongoId()],
  storeController.reactivateStore
);

// Delete store (Admin only)
storeRouter.delete(
  "/:id",
  auth,
  roleCheck(["admin"]),
  [param("id").isMongoId()],
  storeController.deleteStore
);

// Add staff member to store (Owner/Admin only)
storeRouter.post(
  "/:storeId/staff/:userId",
  auth,
  roleCheck(["owner", "admin"]),
  [param("storeId").isMongoId(), param("userId").isMongoId()],
  storeController.addStaffMember
);

// Remove staff member from store (Owner/Admin only)
storeRouter.delete(
  "/:storeId/staff/:userId",
  auth,
  roleCheck(["owner", "admin"]),
  [param("storeId").isMongoId(), param("userId").isMongoId()],
  storeController.removeStaffMember
);

// Update operating hours (Owner/Admin only)
storeRouter.patch(
  "/:id/operating-hours",
  auth,
  roleCheck(["owner", "admin"]),
  [param("id").isMongoId(), ...operatingHoursValidation],
  storeController.updateOperatingHours
);

// Get stores by owner
storeRouter.get(
  "/owner/:ownerId",
  auth,
  [param("ownerId").isMongoId()],
  storeController.getStoresByOwner
);

// Search stores
storeRouter.get(
  "/search",
  auth,
  [query("query").trim().notEmpty().withMessage("Search query is required")],
  storeController.searchStores
);

// Get stores by staff member
storeRouter.get(
  "/staff/:staffId",
  auth,
  [param("staffId").isMongoId()],
  storeController.getStoresByStaff
);

// Change store owner (Current Owner/Admin only)
storeRouter.patch(
  "/:storeId/change-owner",
  auth,
  roleCheck(["owner", "admin"]),
  [
    param("storeId").isMongoId(),
    body("newOwnerId")
      .isMongoId()
      .withMessage("Valid new owner ID is required"),
  ],
  storeController.changeStoreOwner
);

export default storeRouter;
