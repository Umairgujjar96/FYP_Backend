import jwt from "jsonwebtoken";
import { check, validationResult } from "express-validator";
import User from "../models/User.js";
import Store from "../models/Store.js";

// Authentication Middleware
export const auth = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res
        .status(401)
        .json({ message: "No authentication token, access denied" });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Get user from database
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: "Account is deactivated" });
    }

    // Check subscription status
    if (
      user.subscription.status === "trial" &&
      user.subscription.trialEnd &&
      new Date() > user.subscription.trialEnd
    ) {
      user.subscription.status = "expired";
      await user.save();
    }

    // Add user to request
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Token is invalid or expired" });
  }
};

// Role Authorization Middleware
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied: insufficient permissions",
      });
    }
    next();
  };
};

// Subscription Check Middleware
export const checkSubscription = async (req, res, next) => {
  try {
    const user = req.user;

    // Allow access during trial period
    if (
      user.subscription.status === "trial" &&
      user.subscription.trialEnd &&
      new Date() <= user.subscription.trialEnd
    ) {
      return next();
    }

    // Allow access for active subscriptions
    if (user.subscription.status === "active") {
      return next();
    }

    return res.status(403).json({
      message: "Subscription required. Please upgrade your plan to continue.",
      subscriptionStatus: user.subscription.status,
    });
  } catch (error) {
    res.status(500).json({ message: "Error checking subscription status" });
  }
};

// Store Access Middleware
export const checkStoreAccess = async (req, res, next) => {
  try {
    const storeId = req.params.storeId || req.body.storeId;

    if (!storeId) {
      return res.status(400).json({ message: "Store ID is required" });
    }

    const store = await Store.findById(storeId);

    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    // Check if user is owner or staff
    const hasAccess =
      store.owner.equals(req.user._id) ||
      store.staff.some((staffId) => staffId.equals(req.user._id));

    if (!hasAccess) {
      return res
        .status(403)
        .json({ message: "Access denied: not authorized for this store" });
    }

    req.store = store;
    next();
  } catch (error) {
    res.status(500).json({ message: "Error checking store access" });
  }
};

// Validation Middleware
export const validate = {
  registration: [
    check("firstName")
      .trim()
      .notEmpty()
      .withMessage("First name is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("First name must be between 2 and 50 characters"),

    check("lastName")
      .trim()
      .notEmpty()
      .withMessage("Last name is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("Last name must be between 2 and 50 characters"),

    check("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),

    check("password")
      .trim()
      .notEmpty()
      .withMessage("Password is required")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters")
      .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*])/)
      .withMessage(
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
      ),

    check("phoneNumber")
      .trim()
      .notEmpty()
      .withMessage("Phone number is required")
      .matches(/^\+?[\d\s-]+$/)
      .withMessage("Invalid phone number format"),

    check("storeName")
      .trim()
      .notEmpty()
      .withMessage("Store name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Store name must be between 2 and 100 characters"),

    check("registrationNumber")
      .trim()
      .notEmpty()
      .withMessage("Registration number is required")
      .isLength({ min: 5, max: 50 })
      .withMessage("Invalid registration number format"),

    check("licenseNumber")
      .trim()
      .notEmpty()
      .withMessage("License number is required")
      .isLength({ min: 5, max: 50 })
      .withMessage("Invalid license number format"),

    check("storeEmail")
      .trim()
      .notEmpty()
      .withMessage("Store email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),

    check("storePhone")
      .trim()
      .notEmpty()
      .withMessage("Store phone is required")
      .matches(/^\+?[\d\s-]+$/)
      .withMessage("Invalid phone number format"),
  ],

  login: [
    check("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),

    check("password").trim().notEmpty().withMessage("Password is required"),
  ],

  updateProfile: [
    check("firstName")
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("First name must be between 2 and 50 characters"),

    check("lastName")
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Last name must be between 2 and 50 characters"),

    check("phoneNumber")
      .optional()
      .trim()
      .matches(/^\+?[\d\s-]+$/)
      .withMessage("Invalid phone number format"),
  ],

  changePassword: [
    check("currentPassword")
      .trim()
      .notEmpty()
      .withMessage("Current password is required"),

    check("newPassword")
      .trim()
      .notEmpty()
      .withMessage("New password is required")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters")
      .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*])/)
      .withMessage(
        "New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
      ),
  ],

  forgotPassword: [
    check("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
  ],
};

// Validation Result Middleware
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};
