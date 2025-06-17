import mongoose from "mongoose";
import { validationResult } from "express-validator";
import fs from "fs";
import path from "path";
import Customer from "../models/Customer.js";
import Store from "../models/Store.js";

/**
 * Customer Controller - Handles all customer-related operations
 */
class CustomerController {
  /**
   * Create a new customer
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createCustomer(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Check if store exists
      const storeId = req.body.store;
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
      // Check if customer with same email already exists for this store
      if (req.body.email) {
        const existingCustomer = await Customer.findOne({
          email: req.body.email,
          store: storeId,
        });

        if (existingCustomer) {
          return res.status(409).json({
            success: false,
            message: "Customer with this email already exists for this store",
          });
        }
      }
      let customer = { ...req.body };
      if (!customer._id || customer._id === "") {
        delete customer._id;
      }

      const newCustomer = new Customer(customer);
      const savedCustomer = await newCustomer.save();

      return res.status(201).json({
        success: true,
        message: "Customer created successfully",
        data: savedCustomer,
      });
    } catch (error) {
      console.error("Error creating customer:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create customer",
        error: error.message,
      });
    }
  }

  /**
   * Get all customers with optional filtering and pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllCustomers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skipIndex = (page - 1) * limit;

      // Build filter object based on query parameters
      const filter = {};

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

      if (req.query.email) {
        filter.email = { $regex: req.query.email, $options: "i" };
      }

      // Get total count for pagination info
      const total = await Customer.countDocuments(filter);

      const customers = await Customer.find(filter)
        .populate("store", "name")
        .sort({ createdAt: -1 })
        .skip(skipIndex)
        .limit(limit);

      return res.status(200).json({
        success: true,
        data: customers,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching customers:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch customers",
        error: error.message,
      });
    }
  }

  /**
   * Get customer by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getCustomerById(req, res) {
    try {
      const customerId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer ID" });
      }

      const customer = await Customer.findById(customerId).populate(
        "store",
        "name"
      );

      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const store = await Store.findById(customer.store);

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
          message: "You do not have permission to view this customer",
        });
      }

      return res.status(200).json({
        success: true,
        data: customer,
      });
    } catch (error) {
      console.error("Error fetching customer:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch customer details",
        error: error.message,
      });
    }
  }

  /**
   * Update customer details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateCustomer(req, res) {
    try {
      // const errors = validationResult(req);
      // if (!errors.isEmpty()) {
      //   return res.status(400).json({ success: false, errors: errors.array() });
      // }

      const customerId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer ID" });
      }

      // Check if customer exists
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const store = await Store.findById(customer.store);

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
          message: "You do not have permission to update this customer",
        });
      }

      // Check for email uniqueness if email is being updated
      if (req.body.email && req.body.email !== customer.email) {
        const existingCustomer = await Customer.findOne({
          email: req.body.email,
          store: customer.store,
          _id: { $ne: customerId },
        });

        if (existingCustomer) {
          return res.status(409).json({
            success: false,
            message:
              "Another customer with this email already exists for this store",
          });
        }
      }

      // Update the customer
      const updatedCustomer = await Customer.findByIdAndUpdate(
        customerId,
        { $set: req.body },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        success: true,
        message: "Customer updated successfully",
        data: updatedCustomer,
      });
    } catch (error) {
      console.error("Error updating customer:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update customer",
        error: error.message,
      });
    }
  }

  /**
   * Delete a customer
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteCustomer(req, res) {
    try {
      const customerId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer ID" });
      }

      // Check if customer exists
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Check authorization - verify user is store owner or admin
      const requestUserId = req.user.id; // Assuming authentication middleware adds user to req
      const store = await Store.findById(customer.store);

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
          message: "Only store owners and administrators can delete customers",
        });
      }

      // Delete related prescription files if they exist
      if (customer.prescriptions && customer.prescriptions.length > 0) {
        customer.prescriptions.forEach((prescription) => {
          if (prescription.file) {
            const filePath = path.join(process.cwd(), prescription.file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
      }

      // Delete the customer
      await Customer.findByIdAndDelete(customerId);

      return res.status(200).json({
        success: true,
        message: "Customer deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting customer:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete customer",
        error: error.message,
      });
    }
  }

  /**
   * Get customers by store ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getCustomersByStore(req, res) {
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
            "You do not have permission to view customers for this store",
        });
      }

      // Apply additional filters if provided
      const filter = {
        store: storeId,
        // Exclude "Walk-in Customer" by name
        name: { $ne: "Walk-in Customer" },
      };

      // Add other filters if provided
      if (req.query.name) {
        filter.name = {
          $regex: req.query.name,
          $options: "i",
          $ne: "Walk-in Customer", // Maintain exclusion while adding regex search
        };
      }

      if (req.query.email) {
        filter.email = { $regex: req.query.email, $options: "i" };
      }

      if (req.query.phoneNumber) {
        filter.phoneNumber = { $regex: req.query.phoneNumber, $options: "i" };
      }

      // Get total count (excluding Walk-in Customer)
      const total = await Customer.countDocuments(filter);

      // Apply pagination if requested
      let query = Customer.find(filter).sort({ name: 1 });

      if (req.query.page && req.query.limit) {
        const page = parseInt(req.query.page);
        const limit = parseInt(req.query.limit);
        const skip = (page - 1) * limit;

        query = query.skip(skip).limit(limit);
      }

      const customers = await query;

      return res.status(200).json({
        success: true,
        count: customers.length,
        total,
        data: customers,
      });
    } catch (error) {
      console.error("Error fetching customers by store:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch customers by store",
        error: error.message,
      });
    }
  }
  /**
   * Search customers
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchCustomers(req, res) {
    try {
      const { storeId, query } = req.query;

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
            "You do not have permission to search customers for this store",
        });
      }

      if (!query) {
        return res
          .status(400)
          .json({ success: false, message: "Search query is required" });
      }

      // Build search filter
      const searchFilter = {
        store: storeId,
        $or: [
          { name: { $regex: query, $options: "i" } },
          { email: { $regex: query, $options: "i" } },
          { phoneNumber: { $regex: query, $options: "i" } },
        ],
      };

      // Apply pagination if provided
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skipIndex = (page - 1) * limit;

      // Get total count for pagination info
      const total = await Customer.countDocuments(searchFilter);

      const customers = await Customer.find(searchFilter)
        .sort({ name: 1 })
        .skip(skipIndex)
        .limit(limit);

      return res.status(200).json({
        success: true,
        count: customers.length,
        data: customers,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit,
        },
      });
    } catch (error) {
      console.error("Error searching customers:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to search customers",
        error: error.message,
      });
    }
  }

  /**
   * Upload prescription for a customer
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadPrescription(req, res) {
    try {
      const customerId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer ID" });
      }

      // Check if customer exists
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id;
      const store = await Store.findById(customer.store);

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
          message:
            "You do not have permission to upload prescriptions for this customer",
        });
      }

      // Validate file existence
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "Prescription file is required" });
      }

      // Prepare prescription data
      const prescriptionData = {
        file: req.file.path,
        uploadDate: new Date(),
        expiryDate: req.body.expiryDate || null,
        status: "active",
      };

      // Add prescription to customer
      customer.prescriptions.push(prescriptionData);
      const updatedCustomer = await customer.save();

      return res.status(200).json({
        success: true,
        message: "Prescription uploaded successfully",
        data: updatedCustomer,
      });
    } catch (error) {
      console.error("Error uploading prescription:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to upload prescription",
        error: error.message,
      });
    }
  }

  /**
   * Delete a prescription
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deletePrescription(req, res) {
    try {
      const { customerId, prescriptionId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer ID" });
      }

      // Check if customer exists
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Check authorization - verify user is store owner or admin
      const requestUserId = req.user.id;
      const store = await Store.findById(customer.store);

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
          message:
            "Only store owners and administrators can delete prescriptions",
        });
      }

      // Find the prescription in the customer's prescriptions array
      const prescriptionIndex = customer.prescriptions.findIndex(
        (p) => p._id.toString() === prescriptionId
      );

      if (prescriptionIndex === -1) {
        return res
          .status(404)
          .json({ success: false, message: "Prescription not found" });
      }

      // Delete the file if it exists
      const prescription = customer.prescriptions[prescriptionIndex];
      if (prescription.file) {
        const filePath = path.join(process.cwd(), prescription.file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Remove the prescription from the array
      customer.prescriptions.splice(prescriptionIndex, 1);
      await customer.save();

      return res.status(200).json({
        success: true,
        message: "Prescription deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting prescription:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete prescription",
        error: error.message,
      });
    }
  }

  // async downloadPrescription(req, res) {
  //   try {
  //     const { customerId, prescriptionId } = req.params;

  //     if (
  //       !mongoose.Types.ObjectId.isValid(customerId) ||
  //       !mongoose.Types.ObjectId.isValid(prescriptionId)
  //     ) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Invalid customer or prescription ID",
  //       });
  //     }

  //     // Check if customer exists
  //     const customer = await Customer.findById(customerId);
  //     if (!customer) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Customer not found" });
  //     }

  //     // Check authorization - verify user is associated with the store
  //     const requestUserId = req.user.id;
  //     const store = await Store.findById(customer.store);

  //     if (!store) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Associated store not found" });
  //     }

  //     const isStoreOwner = store.owner.toString() === requestUserId;
  //     const isStoreStaff = store.staff.some(
  //       (staffId) => staffId.toString() === requestUserId
  //     );
  //     const isAdmin = req.user.role === "admin";

  //     if (!isStoreOwner && !isStoreStaff && !isAdmin) {
  //       return res.status(403).json({
  //         success: false,
  //         message:
  //           "You do not have permission to access prescriptions for this customer",
  //       });
  //     }

  //     // Find the prescription in the customer's prescriptions array
  //     const prescription = customer.prescriptions.find(
  //       (p) => p._id.toString() === prescriptionId
  //     );

  //     if (!prescription) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Prescription not found" });
  //     }

  //     // Get the file path
  //     let filePath = prescription.file;
  //     console.log("Original file path:", filePath);

  //     // Resolve path if it's a relative path in uploads folder
  //     if (!path.isAbsolute(filePath)) {
  //       // Resolve the path relative to the project root
  //       filePath = path.join(process.cwd(), "uploads/prescriptions", filePath);
  //       console.log("Resolved file path:", filePath);
  //     }

  //     // Check if file exists
  //     if (!fs.existsSync(filePath)) {
  //       console.error(`File not found at: ${filePath}`);
  //       return res.status(404).json({
  //         success: false,
  //         message: "Prescription file does not exist on server",
  //       });
  //     }

  //     // Get filename from path
  //     const filename = path.basename(filePath);

  //     // Set header for inline display instead of download
  //     res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

  //     // Determine content type
  //     const contentType = this.getContentType(filePath);
  //     res.setHeader("Content-Type", contentType);

  //     // Set additional headers to prevent caching issues
  //     res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  //     res.setHeader("Pragma", "no-cache");
  //     res.setHeader("Expires", "0");

  //     console.log(`Sending file: ${filename} (${contentType})`);

  //     // Create a read stream and pipe it to the response
  //     const fileStream = fs.createReadStream(filePath);

  //     fileStream.on("error", (err) => {
  //       console.error("File stream error:", err);
  //       // Only send error if headers haven't been sent already
  //       if (!res.headersSent) {
  //         return res.status(500).json({
  //           success: false,
  //           message: "Error streaming file",
  //           error: err.message,
  //         });
  //       }
  //     });

  //     fileStream.pipe(res);
  //   } catch (error) {
  //     console.error("Error downloading prescription:", error);
  //     return res.status(500).json({
  //       success: false,
  //       message: "Failed to download prescription",
  //       error: error.message,
  //     });
  //   }
  // }

  async downloadPrescription(req, res) {
    try {
      const { customerId, prescriptionId } = req.params;

      if (
        !mongoose.Types.ObjectId.isValid(customerId) ||
        !mongoose.Types.ObjectId.isValid(prescriptionId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid customer or prescription ID",
        });
      }

      // Check if customer exists
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Check authorization - verify user is associated with the store
      const requestUserId = req.user.id;
      const store = await Store.findById(customer.store);

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
          message:
            "You do not have permission to access prescriptions for this customer",
        });
      }

      // Find the prescription in the customer's prescriptions array
      const prescription = customer.prescriptions.find(
        (p) => p._id.toString() === prescriptionId
      );

      if (!prescription) {
        return res
          .status(404)
          .json({ success: false, message: "Prescription not found" });
      }

      // Get the file path
      let filePath = prescription.file;

      // Resolve path if it's a relative path in uploads folder
      if (!path.isAbsolute(filePath)) {
        // Resolve the path relative to the project root
        filePath = path.join(process.cwd(), "uploads/prescriptions", filePath);
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at: ${filePath}`);
        return res.status(404).json({
          success: false,
          message: "Prescription file does not exist on server",
        });
      }

      // Get filename from path
      const filename = path.basename(filePath);

      // Set header for inline display instead of download
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      // Determine content type
      const contentType = getContentType(filePath);
      res.setHeader("Content-Type", contentType);

      // Set additional headers to prevent caching issues
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      // Create a read stream and pipe it to the response
      const fileStream = fs.createReadStream(filePath);

      fileStream.on("error", (err) => {
        console.error("File stream error:", err);
        // Only send error if headers haven't been sent already
        if (!res.headersSent) {
          return res.status(500).json({
            success: false,
            message: "Error streaming file",
            error: err.message,
          });
        }
      });

      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading prescription:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to download prescription",
        error: error.message,
      });
    }
  }

  /**
   * Download a prescription file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  // async downloadPrescription(req, res) {
  //   try {
  //     const { customerId, prescriptionId } = req.params;

  //     if (
  //       !mongoose.Types.ObjectId.isValid(customerId) ||
  //       !mongoose.Types.ObjectId.isValid(prescriptionId)
  //     ) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Invalid customer or prescription ID",
  //       });
  //     }

  //     // Check if customer exists
  //     const customer = await Customer.findById(customerId);
  //     if (!customer) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Customer not found" });
  //     }

  //     // Check authorization - verify user is associated with the store
  //     const requestUserId = req.user.id;
  //     const store = await Store.findById(customer.store);

  //     if (!store) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Associated store not found" });
  //     }

  //     const isStoreOwner = store.owner.toString() === requestUserId;
  //     const isStoreStaff = store.staff.some(
  //       (staffId) => staffId.toString() === requestUserId
  //     );
  //     const isAdmin = req.user.role === "admin";

  //     if (!isStoreOwner && !isStoreStaff && !isAdmin) {
  //       return res.status(403).json({
  //         success: false,
  //         message:
  //           "You do not have permission to access prescriptions for this customer",
  //       });
  //     }

  //     // Find the prescription in the customer's prescriptions array
  //     const prescription = customer.prescriptions.find(
  //       (p) => p._id.toString() === prescriptionId
  //     );

  //     if (!prescription) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Prescription not found" });
  //     }

  //     // Get the file path
  //     const filePath = prescription.file;
  //     console.log(filePath);
  //     if (!filePath) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Prescription file not found" });
  //     }

  //     // Check if file exists
  //     if (!fs.existsSync(filePath)) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "Prescription file does not exist on server",
  //       });
  //     }

  //     // Get filename from path
  //     const filename = path.basename(filePath);

  //     // Set appropriate headers
  //     res.setHeader(
  //       "Content-Disposition",
  //       `attachment; filename="${filename}"`
  //     );
  //     res.setHeader("Content-Type", this.getContentType(filePath));

  //     // Stream the file to the response
  //     const fileStream = fs.createReadStream(filePath);
  //     fileStream.pipe(res);
  //   } catch (error) {
  //     console.error("Error downloading prescription:", error);
  //     return res.status(500).json({
  //       success: false,
  //       message: "Failed to download prescription",
  //       error: error.message,
  //     });
  //   }
  // }

  // async downloadPrescription(req, res) {
  //   try {
  //     const { customerId, prescriptionId } = req.params;

  //     if (
  //       !mongoose.Types.ObjectId.isValid(customerId) ||
  //       !mongoose.Types.ObjectId.isValid(prescriptionId)
  //     ) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Invalid customer or prescription ID",
  //       });
  //     }

  //     // Check if customer exists
  //     const customer = await Customer.findById(customerId);
  //     if (!customer) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Customer not found" });
  //     }

  //     // Check authorization - verify user is associated with the store
  //     const requestUserId = req.user.id;
  //     const store = await Store.findById(customer.store);

  //     if (!store) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Associated store not found" });
  //     }

  //     const isStoreOwner = store.owner.toString() === requestUserId;
  //     const isStoreStaff = store.staff.some(
  //       (staffId) => staffId.toString() === requestUserId
  //     );
  //     const isAdmin = req.user.role === "admin";

  //     if (!isStoreOwner && !isStoreStaff && !isAdmin) {
  //       return res.status(403).json({
  //         success: false,
  //         message:
  //           "You do not have permission to access prescriptions for this customer",
  //       });
  //     }

  //     // Find the prescription in the customer's prescriptions array
  //     const prescription = customer.prescriptions.find(
  //       (p) => p._id.toString() === prescriptionId
  //     );

  //     if (!prescription) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Prescription not found" });
  //     }

  //     // Get the file path
  //     let filePath = prescription.file;
  //     console.log("Original file path:", filePath);

  //     // Resolve path if it's a relative path in uploads folder
  //     if (!path.isAbsolute(filePath)) {
  //       // Resolve the path relative to the project root
  //       filePath = path.join(process.cwd(), "uploads/prescriptions", filePath);
  //       console.log("Resolved file path:", filePath);
  //     }

  //     // Check if file exists
  //     if (!fs.existsSync(filePath)) {
  //       console.error(`File not found at: ${filePath}`);
  //       return res.status(404).json({
  //         success: false,
  //         message: "Prescription file does not exist on server",
  //       });
  //     }

  //     // Get filename from path
  //     const filename = path.basename(filePath);

  //     // Set appropriate headers
  //     res.setHeader(
  //       "Content-Disposition",
  //       `attachment; filename="${filename}"`
  //     );

  //     // Determine content type
  //     const contentType = this.getContentType(filePath);
  //     res.setHeader("Content-Type", contentType);

  //     // Set additional headers to prevent caching issues
  //     res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  //     res.setHeader("Pragma", "no-cache");
  //     res.setHeader("Expires", "0");

  //     console.log(`Sending file: ${filename} (${contentType})`);

  //     // Create a read stream and pipe it to the response
  //     const fileStream = fs.createReadStream(filePath);

  //     fileStream.on("error", (err) => {
  //       console.error("File stream error:", err);
  //       // Only send error if headers haven't been sent already
  //       if (!res.headersSent) {
  //         return res.status(500).json({
  //           success: false,
  //           message: "Error streaming file",
  //           error: err.message,
  //         });
  //       }
  //     });

  //     fileStream.pipe(res);
  //   } catch (error) {
  //     console.error("Error downloading prescription:", error);
  //     return res.status(500).json({
  //       success: false,
  //       message: "Failed to download prescription",
  //       error: error.message,
  //     });
  //   }
  // }

  // Helper method to determine content type based on file extension

  getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".tiff": "image/tiff",
      ".bmp": "image/bmp",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };

    return contentTypes[ext] || "application/octet-stream";
  }

  // Helper method to determine content type based on file extension
  // getContentType(filePath) {
  //   const ext = path.extname(filePath).toLowerCase();
  //   const contentTypes = {
  //     ".pdf": "application/pdf",
  //     ".jpg": "image/jpeg",
  //     ".jpeg": "image/jpeg",
  //     ".png": "image/png",
  //     ".gif": "image/gif",
  //     ".tiff": "image/tiff",
  //     ".bmp": "image/bmp",
  //     ".doc": "application/msword",
  //     ".docx":
  //       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  //   };

  //   return contentTypes[ext] || "application/octet-stream";
  // }
  /**
   * Helper method to determine content type
   * @param {String} filePath - Path to the file
   * @returns {String} Content type
   */
  // getContentType(filePath) {
  //   const ext = path.extname(filePath).toLowerCase();

  //   switch (ext) {
  //     case ".pdf":
  //       return "application/pdf";
  //     case ".jpg":
  //     case ".jpeg":
  //       return "image/jpeg";
  //     case ".png":
  //       return "image/png";
  //     case ".gif":
  //       return "image/gif";
  //     default:
  //       return "application/octet-stream";
  //   }
  // }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
  };

  return mimeTypes[ext] || "application/octet-stream";
}

export default CustomerController;
