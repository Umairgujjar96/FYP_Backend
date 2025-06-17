import jwt from "jsonwebtoken";
import { promisify } from "util";
import User from "../models/User.js";

/**
 * Middleware to protect routes - verifies JWT token and attaches user to request
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    // Check if token exists in headers
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }
    // Check if token exists in cookies
    else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Please log in to access this resource",
      });
    }

    try {
      // Verify token
      const decoded = await promisify(jwt.verify)(
        token,
        process.env.JWT_ACCESS_SECRET
      );
      // Check if user still exists
      const user = await User.findById(decoded.id).select("+passwordChangedAt");

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "The user belonging to this token no longer exists",
        });
      }

      // Check if user changed password after token was issued
      if (user.passwordChangedAt) {
        const changedTimestamp = parseInt(
          user.passwordChangedAt.getTime() / 1000,
          10
        );

        if (decoded.iat < changedTimestamp) {
          return res.status(401).json({
            success: false,
            message: "User recently changed password. Please log in again",
          });
        }
      }

      // Add user to request object
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Invalid token. Please log in again",
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error authenticating user",
      error: error.message,
    });
  }
};

/**
 * Middleware for role-based authorization
 * @param  {...string} roles - Allowed roles
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this resource`,
      });
    }
    next();
  };
};

/**
 * Middleware to ensure user belongs to store
 * Used for routes where store ID is passed as a parameter
 */
export const belongsToStore = async (req, res, next) => {
  try {
    const storeId = req.params.storeId || req.query.store || req.body.store;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    // For owner, check if they own the store
    if (req.user.role === "owner") {
      if (req.user.store.toString() !== storeId) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to access this store",
        });
      }
    }
    // For staff/manager, check if they are assigned to the store
    else {
      const isAssigned = req.user.assignedStores.some(
        (store) => store.toString() === storeId
      );

      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          message: "You are not assigned to this store",
        });
      }
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error checking store authorization",
      error: error.message,
    });
  }
};

/**
 * Middleware to refresh token if it's close to expiry
 */
export const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

    if (token) {
      const decoded = await promisify(jwt.verify)(
        token,
        process.env.JWT_SECRET
      );
      const timeUntilExpiry = decoded.exp - Math.floor(Date.now() / 1000);

      // If token is close to expiry (less than 15 minutes), issue a new one
      if (timeUntilExpiry < 900) {
        const user = await User.findById(decoded.id);
        const newToken = user.getSignedJwtToken();

        // Set cookie options
        const cookieOptions = {
          expires: new Date(
            Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000
          ),
          httpOnly: true,
        };

        if (process.env.NODE_ENV === "production") {
          cookieOptions.secure = true;
        }

        res.cookie("token", newToken, cookieOptions);
        req.headers.authorization = `Bearer ${newToken}`;
      }
    }

    next();
  } catch (error) {
    // If there's an error refreshing the token, continue without refreshing
    next();
  }
};

export const logout = (req, res) => {
  res.cookie("token", "none", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    message: "User logged out successfully",
  });
};
