import { validationResult } from "express-validator";
import mongoose from "mongoose";
import Store from "../models/Store.js";
import User from "../models/User.js";

/**
 * Store Controller - Handles all store-related operations
 */
class StoreController {
  /**
   * Create a new store
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createStore(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Check if user exists and has appropriate permissions
      const owner = await User.findById(req.body.owner);
      if (!owner) {
        return res
          .status(404)
          .json({ success: false, message: "Owner not found" });
      }

      if (!["admin", "owner"].includes(owner.role)) {
        return res.status(403).json({
          success: false,
          message: "User does not have permission to create a store",
        });
      }

      // Check if store with same registration or license number already exists
      const existingStore = await Store.findOne({
        $or: [
          { registrationNumber: req.body.registrationNumber },
          { licenseNumber: req.body.licenseNumber },
          { email: req.body.email },
        ],
      });

      if (existingStore) {
        return res.status(409).json({
          success: false,
          message:
            "Store with same registration number, license number, or email already exists",
        });
      }

      const newStore = new Store(req.body);
      const savedStore = await newStore.save();

      return res.status(201).json({
        success: true,
        message: "Store created successfully",
        data: savedStore,
      });
    } catch (error) {
      console.error("Error creating store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create store",
        error: error.message,
      });
    }
  }

  /**
   * Get all stores with optional filtering and pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllStores(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skipIndex = (page - 1) * limit;

      // Build filter object based on query parameters
      const filter = {
        isActive: req.query.isActive === "false" ? false : true,
      };

      if (req.query.owner) {
        filter.owner = req.query.owner;
      }

      if (req.query.name) {
        filter.name = { $regex: req.query.name, $options: "i" };
      }

      if (req.query.city) {
        filter["address.city"] = { $regex: req.query.city, $options: "i" };
      }

      if (req.query.state) {
        filter["address.state"] = { $regex: req.query.state, $options: "i" };
      }

      // Get total count for pagination info
      const total = await Store.countDocuments(filter);

      const stores = await Store.find(filter)
        .populate("owner", "firstName lastName email")
        .populate("staff", "firstName lastName email role")
        .sort({ createdAt: -1 })
        .skip(skipIndex)
        .limit(limit);

      return res.status(200).json({
        success: true,
        data: stores,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching stores:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch stores",
        error: error.message,
      });
    }
  }

  /**
   * Get store by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStoreById(req, res) {
    try {
      const storeId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store ID" });
      }

      const store = await Store.findById(storeId)
        .populate("owner", "firstName lastName email phoneNumber")
        .populate("staff", "firstName lastName email role");

      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      return res.status(200).json({
        success: true,
        data: store,
      });
    } catch (error) {
      console.error("Error fetching store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch store details",
        error: error.message,
      });
    }
  }

  /**
   * Update store details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateStore(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const storeId = req.params.id;

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

      // If updating unique fields, check for conflicts
      if (
        req.body.registrationNumber ||
        req.body.licenseNumber ||
        req.body.email
      ) {
        const uniqueFieldsQuery = [];

        if (
          req.body.registrationNumber &&
          req.body.registrationNumber !== store.registrationNumber
        ) {
          uniqueFieldsQuery.push({
            registrationNumber: req.body.registrationNumber,
          });
        }

        if (
          req.body.licenseNumber &&
          req.body.licenseNumber !== store.licenseNumber
        ) {
          uniqueFieldsQuery.push({ licenseNumber: req.body.licenseNumber });
        }

        if (req.body.email && req.body.email !== store.email) {
          uniqueFieldsQuery.push({ email: req.body.email });
        }

        if (uniqueFieldsQuery.length > 0) {
          const existingStore = await Store.findOne({
            $or: uniqueFieldsQuery,
            _id: { $ne: storeId },
          });

          if (existingStore) {
            return res.status(409).json({
              success: false,
              message:
                "Another store with the same registration number, license number, or email already exists",
            });
          }
        }
      }

      // Check authorization - only owner or admin can update
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this store",
        });
      }

      // Update the store
      const updatedStore = await Store.findByIdAndUpdate(
        storeId,
        { $set: req.body },
        { new: true, runValidators: true }
      )
        .populate("owner", "firstName lastName email")
        .populate("staff", "firstName lastName email role");

      return res.status(200).json({
        success: true,
        message: "Store updated successfully",
        data: updatedStore,
      });
    } catch (error) {
      console.error("Error updating store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update store",
        error: error.message,
      });
    }
  }

  /**
   * Deactivate a store (soft delete)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deactivateStore(req, res) {
    try {
      const storeId = req.params.id;

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

      // Check authorization - only owner or admin can deactivate
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to deactivate this store",
        });
      }

      // Deactivate the store
      store.isActive = false;
      await store.save();

      return res.status(200).json({
        success: true,
        message: "Store deactivated successfully",
      });
    } catch (error) {
      console.error("Error deactivating store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to deactivate store",
        error: error.message,
      });
    }
  }

  /**
   * Reactivate a store
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async reactivateStore(req, res) {
    try {
      const storeId = req.params.id;

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

      // Check authorization - only owner or admin can reactivate
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to reactivate this store",
        });
      }

      // Reactivate the store
      store.isActive = true;
      await store.save();

      return res.status(200).json({
        success: true,
        message: "Store reactivated successfully",
      });
    } catch (error) {
      console.error("Error reactivating store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reactivate store",
        error: error.message,
      });
    }
  }

  /**
   * Permanently delete a store (hard delete)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteStore(req, res) {
    try {
      const storeId = req.params.id;

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

      // Check authorization - only admin can permanently delete
      const isAdmin = req.user.role === "admin";

      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only administrators can permanently delete stores",
        });
      }

      // Delete the store
      await Store.findByIdAndDelete(storeId);

      return res.status(200).json({
        success: true,
        message: "Store permanently deleted",
      });
    } catch (error) {
      console.error("Error deleting store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete store",
        error: error.message,
      });
    }
  }

  /**
   * Add staff member to a store
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async addStaffMember(req, res) {
    try {
      const { storeId, userId } = req.params;

      if (
        !mongoose.Types.ObjectId.isValid(storeId) ||
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store or user ID" });
      }

      // Check if store exists
      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Check if user exists and has staff role
      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if (user.role !== "staff") {
        return res.status(400).json({
          success: false,
          message: "User must have staff role to be added to store staff",
        });
      }

      // Check authorization - only store owner or admin can add staff
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add staff to this store",
        });
      }

      // Check if user is already in staff list
      if (store.staff.includes(userId)) {
        return res.status(409).json({
          success: false,
          message: "User is already a staff member of this store",
        });
      }

      // Add user to staff
      store.staff.push(userId);
      await store.save();

      return res.status(200).json({
        success: true,
        message: "Staff member added successfully",
        data: await store.populate("staff", "firstName lastName email role"),
      });
    } catch (error) {
      console.error("Error adding staff member:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to add staff member",
        error: error.message,
      });
    }
  }

  /**
   * Remove staff member from a store
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async removeStaffMember(req, res) {
    try {
      const { storeId, userId } = req.params;

      if (
        !mongoose.Types.ObjectId.isValid(storeId) ||
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store or user ID" });
      }

      // Check if store exists
      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Check authorization - only store owner or admin can remove staff
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to remove staff from this store",
        });
      }

      // Check if user is in staff list
      if (!store.staff.includes(userId)) {
        return res.status(404).json({
          success: false,
          message: "User is not a staff member of this store",
        });
      }

      // Remove user from staff
      store.staff = store.staff.filter(
        (staffId) => staffId.toString() !== userId
      );
      await store.save();

      return res.status(200).json({
        success: true,
        message: "Staff member removed successfully",
        data: await store.populate("staff", "firstName lastName email role"),
      });
    } catch (error) {
      console.error("Error removing staff member:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to remove staff member",
        error: error.message,
      });
    }
  }

  /**
   * Update store operating hours
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateOperatingHours(req, res) {
    try {
      const storeId = req.params.id;
      const { open, close, holidays } = req.body;

      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store ID" });
      }

      // Validate operating hours format (HH:MM format)
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (open && !timeRegex.test(open)) {
        return res.status(400).json({
          success: false,
          message: "Opening time must be in HH:MM format",
        });
      }

      if (close && !timeRegex.test(close)) {
        return res.status(400).json({
          success: false,
          message: "Closing time must be in HH:MM format",
        });
      }

      // Check if store exists
      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Check authorization - only store owner or admin can update operating hours
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to update operating hours for this store",
        });
      }

      // Update operating hours
      const operatingHours = {
        ...store.operatingHours,
        ...(open && { open }),
        ...(close && { close }),
        ...(holidays && { holidays }),
      };

      store.operatingHours = operatingHours;
      await store.save();

      return res.status(200).json({
        success: true,
        message: "Operating hours updated successfully",
        data: {
          operatingHours: store.operatingHours,
        },
      });
    } catch (error) {
      console.error("Error updating operating hours:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update operating hours",
        error: error.message,
      });
    }
  }

  /**
   * Get stores by owner ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStoresByOwner(req, res) {
    try {
      const ownerId = req.params.ownerId;

      if (!mongoose.Types.ObjectId.isValid(ownerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid owner ID" });
      }

      // Check if user exists
      const owner = await User.findById(ownerId);
      if (!owner) {
        return res
          .status(404)
          .json({ success: false, message: "Owner not found" });
      }

      // Get stores for the owner
      const stores = await Store.find({
        owner: ownerId,
        isActive: true,
      }).populate("staff", "firstName lastName email role");

      return res.status(200).json({
        success: true,
        count: stores.length,
        data: stores,
      });
    } catch (error) {
      console.error("Error fetching stores by owner:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch stores by owner",
        error: error.message,
      });
    }
  }

  /**
   * Search stores by name, city, or state
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchStores(req, res) {
    try {
      const { query } = req.query;

      if (!query) {
        return res
          .status(400)
          .json({ success: false, message: "Search query is required" });
      }

      const stores = await Store.find({
        isActive: true,
        $or: [
          { name: { $regex: query, $options: "i" } },
          { "address.city": { $regex: query, $options: "i" } },
          { "address.state": { $regex: query, $options: "i" } },
        ],
      }).populate("owner", "firstName lastName email");

      return res.status(200).json({
        success: true,
        count: stores.length,
        data: stores,
      });
    } catch (error) {
      console.error("Error searching stores:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to search stores",
        error: error.message,
      });
    }
  }

  /**
   * Get stores where staff member works
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStoresByStaff(req, res) {
    try {
      const staffId = req.params.staffId;

      if (!mongoose.Types.ObjectId.isValid(staffId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid staff ID" });
      }

      // Check if user exists and is staff
      const staff = await User.findById(staffId);
      if (!staff) {
        return res
          .status(404)
          .json({ success: false, message: "Staff member not found" });
      }

      if (staff.role !== "staff") {
        return res
          .status(400)
          .json({ success: false, message: "User is not a staff member" });
      }

      // Get stores where staff member works
      const stores = await Store.find({
        staff: staffId,
        isActive: true,
      }).populate("owner", "firstName lastName email");

      return res.status(200).json({
        success: true,
        count: stores.length,
        data: stores,
      });
    } catch (error) {
      console.error("Error fetching stores by staff:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch stores by staff",
        error: error.message,
      });
    }
  }

  /**
   * Change store owner
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async changeStoreOwner(req, res) {
    try {
      const { storeId } = req.params;
      const { newOwnerId } = req.body;

      if (
        !mongoose.Types.ObjectId.isValid(storeId) ||
        !mongoose.Types.ObjectId.isValid(newOwnerId)
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store or new owner ID" });
      }

      // Check if store exists
      const store = await Store.findById(storeId);
      if (!store) {
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Check if new owner exists and has owner role
      const newOwner = await User.findById(newOwnerId);
      if (!newOwner) {
        return res
          .status(404)
          .json({ success: false, message: "New owner not found" });
      }

      if (!["admin", "owner"].includes(newOwner.role)) {
        return res.status(400).json({
          success: false,
          message: "New owner must have owner role",
        });
      }

      // Check authorization - only current owner or admin can transfer ownership
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const isCurrentOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isCurrentOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to transfer store ownership",
        });
      }

      // Update store owner
      store.owner = newOwnerId;

      // If new owner was in staff, remove them from staff
      if (store.staff.includes(newOwnerId)) {
        store.staff = store.staff.filter(
          (staffId) => staffId.toString() !== newOwnerId
        );
      }

      await store.save();

      return res.status(200).json({
        success: true,
        message: "Store ownership transferred successfully",
        data: await store.populate("owner", "firstName lastName email"),
      });
    } catch (error) {
      console.error("Error changing store owner:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to change store owner",
        error: error.message,
      });
    }
  }
}

export default StoreController;
