import Category from "../models/Category.js";
import Store from "../models/Store.js";

// Create a new category
export const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Store ID and category name are required",
      });
    }
    const storeId =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.body.store;

    // Validate store existence
    const storeExists = await Store.exists({ _id: storeId, isActive: true });
    if (!storeExists) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // Check for duplicate category name within the store
    const existingCategory = await Category.findOne({
      store: storeId,
      name: name.trim(),
      isActive: true,
    });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: "Category with this name already exists in the store",
      });
    }

    // Create and save new category
    const newCategory = new Category({
      store: storeId,
      name,
      description,
      isActive: true,
    });

    await newCategory.save();

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: newCategory,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: error.message,
    });
  }
};

// Get all categories for a specific store
export const getCategories = async (req, res) => {
  try {
    const { storeId } = req.params;

    // Validate store existence
    const storeExists = await Store.exists({ _id: storeId, isActive: true });
    if (!storeExists) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const categories = await Category.find({ store: storeId, isActive: true });

    return res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve categories",
      error: error.message,
    });
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name, description } = req.body;

    // Find and update category
    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      { name, description },
      { new: true }
    );

    if (!updatedCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: updatedCategory,
    });
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update category",
      error: error.message,
    });
  }
};

// Delete category (Soft delete)
export const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    // Find and update category to set isActive to false
    const deletedCategory = await Category.findByIdAndUpdate(
      categoryId,
      { isActive: false },
      { new: true }
    );

    if (!deletedCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete category",
      error: error.message,
    });
  }
};
