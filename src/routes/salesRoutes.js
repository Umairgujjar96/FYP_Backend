import express from "express";
import { body } from "express-validator";
import SaleController from "../controllers/saleController.js";
import { auth } from "../middleware/authMiddleware.js";
import roleCheck from "../middleware/roleCheck.js";

const salesRouter = express.Router();
const saleController = new SaleController();

// Validation middleware for sale creation
const createSaleValidation = [
  body("items")
    .isArray()
    .withMessage("Items must be an array")
    .notEmpty()
    .withMessage("At least one item is required"),
  body("items.*.product")
    .notEmpty()
    .withMessage("Product ID is required for each item"),
  // body("items.*.batch")
  //   .notEmpty()
  //   .withMessage("Batch ID is required for each item"),
  body("items.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Quantity must be at least 1"),
  body("items.*.unitPrice")
    .isFloat({ min: 0 })
    .withMessage("Unit price must be a positive number"),
  body("subtotal")
    .isFloat({ min: 0 })
    .withMessage("Subtotal must be a positive number"),
  body("total")
    .isFloat({ min: 0 })
    .withMessage("Total must be a positive number"),
  body("payment.method")
    .isIn(["cash", "card", "mobileBanking", "other"])
    .withMessage("Invalid payment method"),
  body("payment.status")
    .isIn(["pending", "completed", "failed"])
    .withMessage("Invalid payment status"),
];

// Create new sale
salesRouter.post(
  "/create",
  auth,
  createSaleValidation,
  saleController.createSale
);

// Get all sales with filtering and pagination
salesRouter.get("/getall", auth, saleController.getAllSales);

// Get sale by ID
salesRouter.get("/getById/:id", auth, saleController.getSaleById);

// Update payment status
salesRouter.patch(
  "/:id/payment-status",
  auth,
  [
    body("status")
      .isIn(["pending", "completed", "failed"])
      .withMessage("Invalid payment status"),
    body("transactionId")
      .optional()
      .isString()
      .withMessage("Transaction ID must be a string"),
  ],
  saleController.updatePaymentStatus
);

// Cancel sale
salesRouter.delete(
  "/:id",
  auth,
  roleCheck(["owner", "admin"]),
  saleController.cancelSale
);

// Get sales reports
// salesRouter.get(
//   "/reports/sales",
//   auth,
//   roleCheck(["owner", "admin"]),
//   saleController.getSalesReport
// );

salesRouter.post(
  "/sales/return",
  auth,
  // [
  //   body("saleId", "Sale ID is required").notEmpty(),
  //   body("returnedItems", "Returned items are required").isArray({ min: 1 }),
  //   body(
  //     "returnedItems.*.productId",
  //     "Product ID is required for each item"
  //   ).notEmpty(),
  //   body(
  //     "returnedItems.*.batchId",
  //     "Batch ID is required for each item"
  //   ).notEmpty(),
  //   body(
  //     "returnedItems.*.quantity",
  //     "Valid quantity is required for each item"
  //   ).isNumeric({ min: 1 }),
  // ],
  saleController.returnProducts
);

// Endpoint to get sale by invoice number (for searching)
salesRouter.get(
  "/sales/invoice/:invoiceNumber",
  auth,
  saleController.getSaleByInvoiceNumber
);

// In your routes file
salesRouter.post("/reports/generate", auth, saleController.generateSalesReport);
salesRouter.post("/reports/export", auth, saleController.exportSalesReport);

salesRouter.post(
  "/reports/generateProfit",
  auth,
  saleController.generateProfitReport
);
salesRouter.post(
  "/reports/exportProfit",
  auth,
  saleController.exportProfitReport
);

export default salesRouter;
