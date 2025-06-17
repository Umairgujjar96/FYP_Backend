import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Store from "../models/Store.js";
import bcrypt from "bcryptjs";
// import { validationResult } from "express-validator";
import Token from "../models/Token.js";
import { validationResult } from "express-validator";
import dotenv from "dotenv";
// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
// const User = require('../models/User'); // Update path to your User model
// const nodemailer = require('nodemailer');
import nodemailer from "nodemailer";
// import jwt from "jsonwebtoken";
dotenv.config();
// Helper function to generate JWT token
const transporter = nodemailer.createTransport({
  service: "gmail", // or your email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Token generation helpers
const generateTokens = (user) => {
  // Access token - short lived (15 minutes)
  const accessToken = jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      subscription: user.subscription.status,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "2d" }
  );

  // Refresh token - long lived (7 days)
  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Helper function to calculate trial end date (30 minutes from now)
const calculateTrialEnd = () => {
  const trialEnd = new Date();
  trialEnd.setMinutes(trialEnd.getMinutes() + 30);
  return trialEnd;
};

const authController = {
  // Register new user and store

  register: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        firstName,
        lastName,
        email,
        password,
        phoneNumber,
        storeName,
        registrationNumber,
        licenseNumber,
        storePhone,
        storeEmail,
        address,
      } = req.body;

      // Check existing user/store
      const [existingUser, existingStore] = await Promise.all([
        User.findOne({ email }),
        Store.findOne({
          $or: [
            { email: storeEmail },
            { registrationNumber },
            { licenseNumber },
          ],
        }),
      ]);

      if (existingUser) {
        return res.status(400).json({
          message: "User already exists with this email",
        });
      }

      if (existingStore) {
        return res.status(400).json({
          message:
            "Store already exists with this email, registration number, or license number",
        });
      }

      // Hash password with strong salt
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user with session tracking
      const user = new User({
        firstName,
        lastName,
        email,
        password: hashedPassword,
        phoneNumber,
        role: "owner",
        subscription: {
          status: "trial",
          trialStart: new Date(),
          trialEnd: new Date(Date.now() + 30 * 60000), // 30 minutes
          currentPlan: "free",
        },
        address,
        lastLogin: new Date(),
        loginAttempts: 0,
      });

      // Create store
      const store = new Store({
        owner: user._id,
        name: storeName,
        registrationNumber,
        licenseNumber,
        phoneNumber: storePhone,
        email: storeEmail,
        address,
        staff: [user._id],
      });

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(user);

      // Save refresh token to database
      const tokenDoc = new Token({
        user: user._id,
        token: refreshToken,
        type: "refresh",
      });

      // Save everything to database
      await Promise.all([user.save(), store.save(), tokenDoc.save()]);

      // Set cookies
      res.cookie("refreshToken", refreshToken, cookieOptions);

      // Return success response
      res.status(201).json({
        message: "Registration successful",
        accessToken,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          subscription: user.subscription,
        },
        store: {
          id: store._id,
          name: store.name,
          registrationNumber: store.registrationNumber,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        message: "Error during registration",
        error: error.message,
      });
    }
  },
  // Login user
  login: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Find user and check login attempts
      const user = await User.findOne({ email });

      if (!user) {
        return res.status(401).json({
          message: "Invalid credentials",
        });
      }

      // Check for account lockout
      if (
        user.loginAttempts >= 5 &&
        user.lockUntil &&
        user.lockUntil > Date.now()
      ) {
        return res.status(423).json({
          message: "Account is temporarily locked. Please try again later.",
          lockUntil: user.lockUntil,
        });
      }

      // Verify password
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        // Increment login attempts
        user.loginAttempts += 1;

        // Lock account if too many attempts
        if (user.loginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 15 * 60000); // 15 minutes
        }

        await user.save();

        return res.status(401).json({
          message: "Invalid credentials",
          attemptsRemaining: 5 - user.loginAttempts,
        });
      }

      // Reset login attempts on successful login
      user.loginAttempts = 0;
      user.lockUntil = null;
      user.lastLogin = new Date();

      // Check and update subscription status
      if (
        user.subscription.status === "trial" &&
        user.subscription.trialEnd &&
        new Date() > user.subscription.trialEnd
      ) {
        user.subscription.status = "expired";
      }

      await user.save();

      // Generate new tokens
      const { accessToken, refreshToken } = generateTokens(user);

      // Save refresh token
      await Token.create({
        user: user._id,
        token: refreshToken,
        type: "refresh",
      });

      // Get associated store
      const store = await Store.findOne(
        user.role === "owner" ? { owner: user._id } : { staff: user._id }
      );

      // Set cookies
      res.cookie("refreshToken", refreshToken, cookieOptions);

      res.json({
        message: "Login successful",
        accessToken,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          subscription: user.subscription,
          phoneNumber: user.phoneNumber,
        },
        store: store
          ? {
              id: store._id,
              name: store.name,
              registrationNumber: store.registrationNumber,
              licenseNumber: store.licenseNumber,
              phoneNumber: store.phoneNumber,
              storeEmail: store.email,
              operatingHours: store.operatingHours,
              staff: store.staff,
            }
          : null,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        message: "Error during login",
        error: error.message,
      });
    }
  },

  // Refresh token
  refresh: async (req, res) => {
    try {
      const refreshToken = req.cookies.refreshToken;

      if (!refreshToken) {
        return res.status(401).json({
          message: "Refresh token not found",
        });
      }

      // Verify token in database
      const tokenDoc = await Token.findOne({
        token: refreshToken,
        type: "refresh",
      });

      if (!tokenDoc) {
        return res.status(401).json({
          message: "Invalid refresh token",
        });
      }

      // Verify JWT
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        await Token.deleteOne({ _id: tokenDoc._id });
        return res.status(401).json({
          message: "User not found",
        });
      }

      // Generate new tokens
      const tokens = generateTokens(user);

      // Update refresh token in database
      tokenDoc.token = tokens.refreshToken;
      await tokenDoc.save();

      // Set new cookies
      res.cookie("refreshToken", tokens.refreshToken, cookieOptions);

      res.json({
        accessToken: tokens.accessToken,
      });
    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(401).json({
        message: "Invalid refresh token",
      });
    }
  },

  // Logout
  logout: async (req, res) => {
    try {
      const refreshToken = req.cookies.refreshToken;

      // Remove refresh token from database
      if (refreshToken) {
        await Token.deleteOne({ token: refreshToken });
      }

      // Clear cookies
      res.clearCookie("refreshToken");

      res.json({
        message: "Logout successful",
      });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({
        message: "Error during logout",
      });
    }
  },

  // Session management
  getSessions: async (req, res) => {
    try {
      const sessions = await Token.find({
        user: req.user.id,
        type: "refresh",
      }).select("createdAt userAgent lastUsed");

      res.json({ sessions });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({
        message: "Error fetching sessions",
      });
    }
  },

  // Terminate all other sessions
  terminateOtherSessions: async (req, res) => {
    try {
      const currentToken = req.cookies.refreshToken;

      await Token.deleteMany({
        user: req.user.id,
        token: { $ne: currentToken },
      });

      res.json({
        message: "All other sessions terminated successfully",
      });
    } catch (error) {
      console.error("Terminate sessions error:", error);
      res.status(500).json({
        message: "Error terminating sessions",
      });
    }
  },
  // Get current user profile
  getProfile: async (req, res) => {
    try {
      const user = await User.findById(req.user.id).select("-password");
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      let store = null;
      if (user.role === "owner") {
        store = await Store.findOne({ owner: user._id });
      } else {
        store = await Store.findOne({ staff: user._id });
      }

      res.json({
        user,
        store: store
          ? {
              id: store._id,
              name: store.name,
              registrationNumber: store.registrationNumber,
            }
          : null,
      });
    } catch (error) {
      console.error("Get profile error:", error);
      res.status(500).json({
        message: "Error fetching profile",
        error: error.message,
      });
    }
  },

  // Update user profile
  updateProfile: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { firstName, lastName, phoneNumber, address } = req.body;

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      // Update fields
      user.firstName = firstName || user.firstName;
      user.lastName = lastName || user.lastName;
      user.phoneNumber = phoneNumber || user.phoneNumber;
      user.address = address || user.address;

      await user.save();

      res.json({
        message: "Profile updated successfully",
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          subscription: user.subscription,
        },
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({
        message: "Error updating profile",
        error: error.message,
      });
    }
  },

  // Change password
  changePassword: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      // Verify current password
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({
          message: "Current password is incorrect",
        });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);

      await user.save();

      res.json({
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        message: "Error changing password",
        error: error.message,
      });
    }
  },

  // Forgot password
  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;

      // Validate email
      if (!email) {
        return res.status(400).json({
          message: "Email is required",
        });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      // Generate password reset token
      const resetToken = jwt.sign(
        { id: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // Create reset URL
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

      // Email template
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Password Reset Request",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>Hello ${user.name || "User"},</p>
            <p>You requested to reset your password. Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #1890ff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p>Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #1890ff;">${resetUrl}</p>
            <p><strong>This link will expire in 1 hour.</strong></p>
            <p>If you didn't request this password reset, please ignore this email.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px;">This is an automated email, please do not reply.</p>
          </div>
        `,
      };

      // Send email
      await transporter.sendMail(mailOptions);

      res.json({
        message: "Password reset instructions sent to email",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({
        message: "Error processing forgot password request",
        error: error.message,
      });
    }
  },

  resetPassword: async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      // Validate inputs
      if (!token || !newPassword) {
        return res.status(400).json({
          message: "Token and new password are required",
        });
      }

      // Validate password strength
      if (newPassword.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long",
        });
      }

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (tokenError) {
        return res.status(400).json({
          message: "Invalid or expired reset token",
        });
      }

      // Find user
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      await User.findByIdAndUpdate(user._id, {
        password: hashedPassword,
        // Optional: Add a field to track password reset
        passwordResetAt: new Date(),
      });

      // Optional: Send confirmation email
      const confirmationMailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "Password Reset Successful",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #52c41a;">Password Reset Successful</h2>
            <p>Hello ${user.name || "User"},</p>
            <p>Your password has been successfully reset.</p>
            <p>If you didn't make this change, please contact our support team immediately.</p>
            <div style="margin: 30px 0; padding: 15px; background-color: #f6ffed; border: 1px solid #b7eb8f; border-radius: 5px;">
              <p style="margin: 0; color: #389e0d;"><strong>Security Tips:</strong></p>
              <ul style="color: #389e0d; margin: 10px 0;">
                <li>Use a strong, unique password</li>
                <li>Don't share your password with anyone</li>
                <li>Consider enabling two-factor authentication</li>
              </ul>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px;">This is an automated email, please do not reply.</p>
          </div>
        `,
      };

      try {
        await transporter.sendMail(confirmationMailOptions);
      } catch (emailError) {
        console.error("Error sending confirmation email:", emailError);
        // Don't fail the request if email fails
      }

      res.json({
        message: "Password reset successfully",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({
        message: "Error resetting password",
        error: error.message,
      });
    }
  },

  // Optional: Verify reset token endpoint
  verifyResetToken: async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          message: "Token is required",
        });
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check if user still exists
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      res.json({
        message: "Token is valid",
        valid: true,
      });
    } catch (error) {
      res.status(400).json({
        message: "Invalid or expired token",
        valid: false,
      });
    }
  },
};

export default authController;
