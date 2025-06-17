import express from "express";
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import { auth } from "../middleware/authMiddleware.js";

const categoryrouter = express.Router();
categoryrouter.post("/categories", auth, createCategory);

// Get all categories for a specific store
categoryrouter.get("/stores/:storeId/categories", getCategories);

// Update a category
categoryrouter.put("/categories/:categoryId", updateCategory);

// Delete a category (soft delete)
categoryrouter.delete("/categories/:categoryId", deleteCategory);
export default categoryrouter;
