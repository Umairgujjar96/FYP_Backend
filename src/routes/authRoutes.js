import { Router } from "express";

const authrouter = Router();

import authController from "../controllers/authController.js";
import { auth } from "../middleware/authMiddleware.js";
authrouter.post("/register", authController.register);
authrouter.post("/login", authController.login);
authrouter.post("/logout", authController.logout);

authrouter.get("/profile", auth, authController.getProfile);
authrouter.put("/profile", auth, authController.updateProfile);
authrouter.put("/change-password", auth, authController.changePassword);
authrouter.post("/forgot-password", authController.forgotPassword);
authrouter.post("/reset-password", authController.resetPassword);
authrouter.post("/verify-reset-token", authController.verifyResetToken); // Optional

export default authrouter;
