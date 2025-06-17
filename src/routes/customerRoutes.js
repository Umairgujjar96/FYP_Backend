import express from "express";
import { body } from "express-validator";
import multer from "multer";
import path from "path";
import CustomerController from "../controllers/CustomerController.js";
import { auth } from "../middleware/authMiddleware.js";
import { fileURLToPath } from "url";
import fs from "fs";
// import { auth } from "../middleware/authMiddleware.js";
// import authMiddleware from "../middleware/authMiddleware.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const customerRouter = express.Router();
const customerController = new CustomerController();

const uploadDir = path.join(__dirname, "..", "uploads", "prescriptions");

// Ensure the directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`
    );
  },
});

// Debug middleware to log incoming requests for file uploads
const logRequest = (req, res, next) => {
  next();
};

// Enhanced Multer configuration with better error handling
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
      return cb(
        new Error(
          "Invalid file type. Only JPEG, PNG, and PDF files are allowed."
        )
      );
    }
  },
}).single("prescription"); // Explicitly define 'prescription' as the field name

// Wrap multer in a custom middleware for better error handling
const uploadMiddleware = (req, res, next) => {
  upload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error("Multer error:", err);
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`,
      });
    } else if (err) {
      console.error("Unknown upload error:", err);
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    // Log what was received after processing

    // Continue to the next middleware
    next();
  });
};
// Validation middleware for customer creation and updates
const customerValidation = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").optional().isEmail().withMessage("Invalid email format"),
  body("phoneNumber").optional().trim(),
  body("store").notEmpty().withMessage("Store ID is required"),
];

// Create a new customer
customerRouter.post(
  "/customers",
  auth,
  customerValidation,
  customerController.createCustomer
);

// Get all customers with filtering and pagination
customerRouter.get("/customers", auth, customerController.getAllCustomers);

// Get customer by ID
customerRouter.get("/customers/:id", auth, customerController.getCustomerById);

// Update customer
customerRouter.put(
  "/customers/:id",
  auth,
  customerValidation,
  customerController.updateCustomer
);

// Delete customer
customerRouter.delete(
  "/customers/:id",
  auth,
  customerController.deleteCustomer
);

// Get customers by store ID
customerRouter.get(
  "/stores/:storeId/customers",
  auth,
  customerController.getCustomersByStore
);

// Search customers
customerRouter.get(
  "/customers/search",
  auth,
  customerController.searchCustomers
);

// Upload prescription
customerRouter.post(
  "/customers/:id/prescriptions",
  auth,
  logRequest, // First log the raw request
  uploadMiddleware, // Then process the file upload with better error handling
  customerController.uploadPrescription
);

// Delete prescription
customerRouter.delete(
  "/customers/:customerId/prescriptions/:prescriptionId",
  auth,
  customerController.deletePrescription
);

customerRouter.get(
  "/:customerId/prescriptions/:prescriptionId/download",
  auth,
  customerController.downloadPrescription
);

export default customerRouter;
