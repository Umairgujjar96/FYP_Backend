import express from "express";
import { body, query, param } from "express-validator";
// import SupplierController from '../controllers/SupplierController';
// import auth from "../middleware/auth";
// import { checkRole } from "../middleware/roleCheck";
// import SupplierController from "../controllers/supplierController";
import roleCheck from "../middleware/roleCheck.js";
import { auth } from "../middleware/authMiddleware.js";
import SupplierController from "../controllers/supplierController.js";

const supplierRouter = express.Router();
const supplierController = new SupplierController();

// Validation middleware for supplier creation and updates
const supplierValidation = [
  body("name").trim().notEmpty().withMessage("Supplier name is required"),
  body("email").optional().isEmail().withMessage("Valid email is required"),
  body("phoneNumber").notEmpty().withMessage("Phone number is required"),
  body("contactPerson").notEmpty().withMessage("Contact person is required"),
  body("store").isMongoId().withMessage("Valid store ID is required"),
  body("address").isObject().withMessage("Address must be an object"),
  body("address.street").notEmpty().withMessage("Street address is required"),
  body("address.city").notEmpty().withMessage("City is required"),
  body("address.state").notEmpty().withMessage("State is required"),
  body("address.postalCode").notEmpty().withMessage("Postal code is required"),
];

// Create supplier
supplierRouter.post(
  "/",
  auth,
  // roleCheck(["admin", "owner", "staff", "owner"]),
  supplierValidation,
  supplierController.createSupplier
);

// Get all suppliers with filters and pagination
supplierRouter.get(
  "/",
  auth,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("isActive").optional().isBoolean(),
    query("store").optional().isMongoId(),
    query("name").optional().trim(),
    query("city").optional().trim(),
  ],
  supplierController.getAllSuppliers
);

// Get supplier by ID
supplierRouter.get(
  "/:id",
  auth,
  [param("id").isMongoId().withMessage("Invalid supplier ID")],
  supplierController.getSupplierById
);

// Update supplier
supplierRouter.put(
  "/:id",
  auth,
  // roleCheck(["admin", "owner", "staff"]),
  // [
  //   param("id").isMongoId().withMessage("Invalid supplier ID"),
  //   ...supplierValidation.map((validation) => validation.optional()),
  // ],
  supplierController.updateSupplier
);

// Deactivate supplier (Owner/Admin only)
supplierRouter.patch(
  "/:id/deactivate",
  auth,
  roleCheck(["admin", "owner"]),
  [param("id").isMongoId().withMessage("Invalid supplier ID")],
  supplierController.deactivateSupplier
);

// Reactivate supplier (Owner/Admin only)
supplierRouter.patch(
  "/:id/reactivate",
  auth,
  roleCheck(["admin", "owner"]),
  [param("id").isMongoId().withMessage("Invalid supplier ID")],
  supplierController.reactivateSupplier
);

// Delete supplier permanently (Admin only)
supplierRouter.delete(
  "/:id",
  auth,
  // roleCheck(["admin"]),
  // [param("id").isMongoId().withMessage("Invalid supplier ID")],
  supplierController.deleteSupplier
);

// Get suppliers by store ID
supplierRouter.get(
  "/store/:storeId",
  auth,
  [
    param("storeId").isMongoId().withMessage("Invalid store ID"),
    query("isActive").optional().isBoolean(),
  ],
  supplierController.getSuppliersByStore
);

// Search suppliers
supplierRouter.get(
  "/search",
  auth,
  [
    query("storeId").isMongoId().withMessage("Valid store ID is required"),
    query("query").trim().notEmpty().withMessage("Search query is required"),
  ],
  supplierController.searchSuppliers
);

export default supplierRouter;
