import { validationResult } from "express-validator";
import mongoose from "mongoose";
import Supplier from "../models/Supplier.js";
import Store from "../models/Store.js";

/**
 * Supplier Controller - Handles all supplier-related operations
 */
class SupplierController {
  /**
   * Create a new supplier
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createSupplier(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Check if store exists
      const storeId =
        req.user.role === "owner"
          ? await Store.findOne({ owner: req.user._id }).select("_id")
          : req.body.store;
      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store ID" });
      }

      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Check if supplier with same email already exists for this store
      if (req.body.email) {
        const existingSupplier = await Supplier.findOne({
          email: req.body.email,
          store: storeId,
        });

        if (existingSupplier) {
          return res.status(409).json({
            success: false,
            message: "Supplier with this email already exists for this store",
          });
        }
      }

      // Create the new supplier
      const newSupplier = new Supplier({
        ...req.body,
        store: storeId,
      });
      const savedSupplier = await newSupplier.save();
      return res.status(201).json({
        success: true,
        message: "Supplier created successfully",
        data: savedSupplier,
      });
    } catch (error) {
      console.error("Error creating supplier:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create supplier",
        error: error.message,
      });
    }
  }

  /**
   * Get all suppliers with optional filtering and pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllSuppliers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skipIndex = (page - 1) * limit;

      // Build filter object based on query parameters
      const filter = {
        isActive: req.query.isActive === "false" ? false : true,
      };

      if (req.query.store) {
        if (!mongoose.Types.ObjectId.isValid(req.query.store)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid store ID" });
        }
        filter.store = req.query.store;
      }

      if (req.query.name) {
        filter.name = { $regex: req.query.name, $options: "i" };
      }

      if (req.query.city) {
        filter["address.city"] = { $regex: req.query.city, $options: "i" };
      }

      // Get total count for pagination info
      const total = await Supplier.countDocuments(filter);

      const suppliers = await Supplier.find(filter)
        .populate("store", "name registrationNumber")
        .sort({ createdAt: -1 })
        .skip(skipIndex)
        .limit(limit);

      return res.status(200).json({
        success: true,
        data: suppliers,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch suppliers",
        error: error.message,
      });
    }
  }

  /**
   * Get supplier by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSupplierById(req, res) {
    try {
      const supplierId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid supplier ID" });
      }

      const supplier = await Supplier.findById(supplierId).populate(
        "store",
        "name registrationNumber email"
      );

      if (!supplier) {
        return res
          .status(404)
          .json({ success: false, message: "Supplier not found" });
      }

      return res.status(200).json({
        success: true,
        data: supplier,
      });
    } catch (error) {
      console.error("Error fetching supplier:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch supplier details",
        error: error.message,
      });
    }
  }

  /**
   * Update supplier details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateSupplier(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const supplierId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid supplier ID" });
      }

      // Check if supplier exists
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res
          .status(404)
          .json({ success: false, message: "Supplier not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const store = await Store.findById(supplier.store);

      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Associated store not found" });
      }

      const isStoreOwner = store.owner.toString() === requestUserId;
      const isStoreStaff = store.staff.some(
        (staffId) => staffId.toString() === requestUserId
      );
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isStoreStaff && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this supplier",
        });
      }

      // Check for email uniqueness if email is being updated
      if (req.body.email && req.body.email !== supplier.email) {
        const existingSupplier = await Supplier.findOne({
          email: req.body.email,
          store: supplier.store,
          _id: { $ne: supplierId },
        });

        if (existingSupplier) {
          return res.status(409).json({
            success: false,
            message:
              "Another supplier with this email already exists for this store",
          });
        }
      }

      // Update the supplier
      const updatedSupplier = await Supplier.findByIdAndUpdate(
        supplierId,
        { $set: req.body },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        success: true,
        message: "Supplier updated successfully",
        data: updatedSupplier,
      });
    } catch (error) {
      console.error("Error updating supplier:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update supplier",
        error: error.message,
      });
    }
  }

  /**
   * Deactivate a supplier (soft delete)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deactivateSupplier(req, res) {
    try {
      const supplierId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid supplier ID" });
      }

      // Check if supplier exists
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res
          .status(404)
          .json({ success: false, message: "Supplier not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const store = await Store.findById(supplier.store);

      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Associated store not found" });
      }

      const isStoreOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to deactivate this supplier",
        });
      }

      // Deactivate the supplier
      supplier.isActive = false;
      await supplier.save();

      return res.status(200).json({
        success: true,
        message: "Supplier deactivated successfully",
      });
    } catch (error) {
      console.error("Error deactivating supplier:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to deactivate supplier",
        error: error.message,
      });
    }
  }

  /**
   * Reactivate a supplier
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async reactivateSupplier(req, res) {
    try {
      const supplierId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid supplier ID" });
      }

      // Check if supplier exists
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res
          .status(404)
          .json({ success: false, message: "Supplier not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const store = await Store.findById(supplier.store);

      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Associated store not found" });
      }

      const isStoreOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to reactivate this supplier",
        });
      }

      // Reactivate the supplier
      supplier.isActive = true;
      await supplier.save();

      return res.status(200).json({
        success: true,
        message: "Supplier reactivated successfully",
      });
    } catch (error) {
      console.error("Error reactivating supplier:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reactivate supplier",
        error: error.message,
      });
    }
  }

  /**
   * Permanently delete a supplier (hard delete)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteSupplier(req, res) {
    try {
      const supplierId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid supplier ID" });
      }

      // Check if supplier exists
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res
          .status(404)
          .json({ success: false, message: "Supplier not found" });
      }

      // Check authorization - only admin can permanently delete
      // const isAdmin = req.user.role === "admin";

      // if (!isAdmin) {
      //   return res.status(403).json({
      //     success: false,
      //     message: "Only administrators can permanently delete suppliers",
      //   });
      // }

      // Delete the supplier
      await Supplier.findByIdAndDelete(supplierId);

      return res.status(200).json({
        success: true,
        message: "Supplier permanently deleted",
      });
    } catch (error) {
      console.error("Error deleting supplier:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete supplier",
        error: error.message,
      });
    }
  }

  /**
   * Get suppliers by store ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSuppliersByStore(req, res) {
    try {
      const storeId = req.params.storeId;

      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store ID" });
      }

      // Check if store exists
      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isStoreOwner = store.owner.toString() === requestUserId;
      const isStoreStaff = store.staff.some(
        (staffId) => staffId.toString() === requestUserId
      );
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isStoreStaff && !isAdmin) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to view suppliers for this store",
        });
      }

      // Get active/inactive suppliers based on query
      const isActive = req.query.isActive === "false" ? false : true;

      // Get suppliers for the store
      const suppliers = await Supplier.find({
        store: storeId,
        isActive,
      }).sort({ name: 1 });

      return res.status(200).json({
        success: true,
        count: suppliers.length,
        data: suppliers,
      });
    } catch (error) {
      console.error("Error fetching suppliers by store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch suppliers by store",
        error: error.message,
      });
    }
  }

  /**
   * Search suppliers by name or contact person
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchSuppliers(req, res) {
    try {
      const { storeId, query } = req.query;

      if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Valid store ID is required" });
      }

      if (!query) {
        return res
          .status(400)
          .json({ success: false, message: "Search query is required" });
      }

      // Check store authorization
      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Get suppliers matching the search query
      const suppliers = await Supplier.find({
        store: storeId,
        isActive: true,
        $or: [
          { name: { $regex: query, $options: "i" } },
          { contactPerson: { $regex: query, $options: "i" } },
        ],
      }).sort({ name: 1 });

      return res.status(200).json({
        success: true,
        count: suppliers.length,
        data: suppliers,
      });
    } catch (error) {
      console.error("Error searching suppliers:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to search suppliers",
        error: error.message,
      });
    }
  }
}

export default SupplierController;
