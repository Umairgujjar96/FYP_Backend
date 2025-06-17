import { validationResult } from "express-validator";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Store from "../models/Store.js";
import Customer from "../models/Customer.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import User from "../models/User.js";

class SaleController {
  async createSale(req, res) {
    // Use a transaction to ensure data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const {
        store,
        customer,
        items,
        subtotal,
        discount, // Represents percentage from frontend
        tax,
        total,
        payment,
        forceCreate = false, // Flag to force creation despite price discrepancies
      } = req.body;

      // Validate required fields
      if (!items || !Array.isArray(items) || items.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Sale must contain at least one item",
        });
      }

      // Validate payment object
      if (!payment || !payment.method) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Payment information is required",
        });
      }

      // Validate numeric values
      if (
        typeof subtotal !== "number" ||
        typeof total !== "number" ||
        (discount !== undefined && typeof discount !== "number") ||
        (tax !== undefined && typeof tax !== "number")
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Sale amounts must be valid numbers",
        });
      }

      // Get storeDoc based on user role
      const storeDoc =
        req.user.role === "owner"
          ? await Store.findOne({ owner: req.user._id })
              .select("_id")
              .session(session)
          : await Store.findById(store).session(session);

      if (!storeDoc) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ success: false, message: "Store not found" });
      }

      // Handle customer lookup or creation
      let customerId = null;
      if (customer && customer !== null) {
        // Validate customer ID format
        if (!mongoose.Types.ObjectId.isValid(customer)) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(400)
            .json({ success: false, message: "Invalid customer ID" });
        }

        // Check if customer exists and belongs to this store
        const customerDoc = await Customer.findById(customer).session(session);
        if (!customerDoc) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(404)
            .json({ success: false, message: "Customer not found" });
        }

        if (customerDoc.store.toString() !== storeDoc._id.toString()) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: "Customer does not belong to this store",
          });
        }

        customerId = customer;
      } else {
        // Find or create walk-in customer
        const existingWalkInCustomer = await Customer.findOne({
          store: storeDoc._id,
          name: "Walk-in Customer",
          email: null,
          phoneNumber: null,
        }).session(session);

        if (existingWalkInCustomer) {
          customerId = existingWalkInCustomer._id;
        } else {
          // Create a new customer for walk-in sales
          const newCustomer = new Customer({
            name: "Walk-in Customer",
            store: storeDoc._id,
            email: null,
            phoneNumber: null,
          });

          const savedCustomer = await newCustomer.save({ session });
          customerId = savedCustomer._id;
        }
      }

      // Generate unique invoice number
      const invoiceNumber = `INV-${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}`;

      // Process each item in the sale
      const processedItems = [];
      let calculatedSubtotal = 0;
      let totalItemDiscount = 0;

      for (const item of items) {
        // Validate product ID
        if (!mongoose.Types.ObjectId.isValid(item.product)) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Invalid product ID: ${item.product}`,
          });
        }

        // Validate item quantity
        if (
          !item.quantity ||
          item.quantity <= 0 ||
          !Number.isInteger(item.quantity)
        ) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Invalid quantity for product ID: ${item.product}`,
          });
        }

        // Get product price
        const itemPrice =
          item.unitPrice !== undefined ? item.unitPrice : item.price;

        // Check if product exists and belongs to the store
        const product = await Product.findOne({
          _id: item.product,
          store: storeDoc._id,
        }).session(session);

        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: `Product with ID ${item.product} not found or doesn't belong to this store`,
          });
        }

        // Set default effective price from product or item
        const defaultEffectivePrice =
          itemPrice === undefined || itemPrice <= 0
            ? product.sellingPrice
            : itemPrice;

        // Find all available batches with stock for this product
        const availableBatches = await Batch.find({
          product: item.product,
          store: storeDoc._id,
          currentStock: { $gt: 0 },
        })
          .sort({ expiryDate: 1 }) // Use oldest batches first (FEFO - First Expiry, First Out)
          .session(session);

        if (!availableBatches || availableBatches.length === 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `No available batches with stock for product ${product.name}`,
          });
        }

        // Calculate total available stock across all batches
        const totalAvailableStock = availableBatches.reduce(
          (sum, batch) => sum + batch.currentStock,
          0
        );

        // Check if there's enough total stock across all batches
        if (totalAvailableStock < item.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Insufficient total stock for product ${product.name}. 
                  Available across all batches: ${totalAvailableStock}, Requested: ${item.quantity}`,
          });
        }

        // If a specific batch is provided in the item, use that batch
        if (item.batch) {
          // Validate batch ID format
          if (!mongoose.Types.ObjectId.isValid(item.batch)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              success: false,
              message: `Invalid batch ID: ${item.batch}`,
            });
          }

          // Find the specified batch
          const specifiedBatch = await Batch.findOne({
            _id: item.batch,
            product: item.product,
            store: storeDoc._id,
          }).session(session);

          if (!specifiedBatch) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
              success: false,
              message: `Batch with ID ${item.batch} not found or doesn't belong to this product`,
            });
          }

          // Check if specified batch has enough stock
          if (specifiedBatch.currentStock < item.quantity) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              success: false,
              message: `Insufficient stock in specified batch for product ${product.name}. 
                    Available in batch: ${specifiedBatch.currentStock}, Requested: ${item.quantity}. 
                    Consider not specifying a batch to use automatic allocation across multiple batches.`,
            });
          }

          // Use specified batch's selling price if available, otherwise use default price
          const effectivePrice =
            specifiedBatch.sellingPrice || defaultEffectivePrice;
          const itemSubtotal = item.quantity * effectivePrice;
          const itemDiscount = item.discount || 0;

          // Add the item to processed items
          processedItems.push({
            product: item.product,
            batch: item.batch,
            quantity: item.quantity,
            unitPrice: effectivePrice,
            subtotal: itemSubtotal,
            discount: itemDiscount,
          });

          // Update totals
          calculatedSubtotal += itemSubtotal;
          totalItemDiscount += itemDiscount;

          // Reduce batch stock
          specifiedBatch.currentStock -= item.quantity;
          await specifiedBatch.save({ session });
        }
        // No specific batch provided - use auto allocation across multiple batches
        else {
          // Allocate from available batches
          let remainingToAllocate = item.quantity;
          const allocations = [];

          for (const batch of availableBatches) {
            // Skip if we've allocated everything already
            if (remainingToAllocate <= 0) break;

            // Skip batches with no stock
            if (batch.currentStock <= 0) continue;

            // Determine quantity to take from this batch
            const quantityFromBatch = Math.min(
              batch.currentStock,
              remainingToAllocate
            );

            // Use batch-specific price where available
            const batchPrice = batch.sellingPrice || defaultEffectivePrice;
            const batchSubtotal = quantityFromBatch * batchPrice;

            // Calculate proportional discount for this batch allocation
            const batchDiscount = item.discount
              ? (item.discount * quantityFromBatch) / item.quantity
              : 0;

            // Create allocation record
            allocations.push({
              product: item.product,
              batch: batch._id,
              quantity: quantityFromBatch,
              unitPrice: batchPrice,
              subtotal: batchSubtotal,
              discount: batchDiscount,
            });

            // Update running totals
            calculatedSubtotal += batchSubtotal;
            totalItemDiscount += batchDiscount;

            // Reduce batch stock
            batch.currentStock -= quantityFromBatch;
            await batch.save({ session });

            // Update remaining quantity to allocate
            remainingToAllocate -= quantityFromBatch;
          }

          // Verify we allocated all requested quantity
          if (remainingToAllocate > 0) {
            // This should never happen since we checked total stock earlier
            await session.abortTransaction();
            session.endSession();
            return res.status(500).json({
              success: false,
              message: `Failed to allocate all requested quantity for product ${product.name}. This is a system error.`,
            });
          }

          // Add all allocations to processed items
          processedItems.push(...allocations);
        }
      }

      // Handle discount calculation
      let cartDiscountAmount = 0;
      let calculatedDiscountAmount = totalItemDiscount;

      // Apply cart-level discount if provided
      const discountPercentage = discount || 0;
      if (discountPercentage > 0) {
        cartDiscountAmount = (calculatedSubtotal * discountPercentage) / 100;
        calculatedDiscountAmount = totalItemDiscount + cartDiscountAmount;

        // Distribute cart discount proportionally across items
        for (const item of processedItems) {
          const proportion = item.subtotal / calculatedSubtotal;
          const itemDiscountFromCart = cartDiscountAmount * proportion;
          item.discount = (item.discount || 0) + itemDiscountFromCart;
        }
      }

      // Calculate final total
      const calculatedTotal =
        calculatedSubtotal - calculatedDiscountAmount + (tax || 0);

      // Check for price discrepancies and handle them
      const epsilon = 0.01; // Allow for small rounding errors
      const subtotalDiscrepancy =
        Math.abs(calculatedSubtotal - subtotal) > epsilon;
      const totalDiscrepancy = Math.abs(calculatedTotal - total) > epsilon;

      // If there are discrepancies and forceCreate is not set, return recalculation response
      if ((subtotalDiscrepancy || totalDiscrepancy) && !forceCreate) {
        // Don't abort transaction yet - just return recalculation data
        await session.abortTransaction();
        session.endSession();

        return res.status(200).json({
          success: false,
          recalculation: true,
          message:
            "Price discrepancy detected. Please review and confirm the recalculated values, or set forceCreate to true to proceed.",
          recalculatedValues: {
            subtotal: parseFloat(calculatedSubtotal.toFixed(2)),
            discount: {
              percentage: discountPercentage,
              amount: parseFloat(calculatedDiscountAmount.toFixed(2)),
            },
            tax: tax || 0,
            total: parseFloat(calculatedTotal.toFixed(2)),
            items: processedItems.map((item) => ({
              productId: item.product,
              batchId: item.batch,
              quantity: item.quantity,
              unitPrice: parseFloat(item.unitPrice.toFixed(2)),
              subtotal: parseFloat(item.subtotal.toFixed(2)),
              discount: parseFloat((item.discount || 0).toFixed(2)),
            })),
          },
          originalValues: {
            subtotal: subtotal,
            total: total,
          },
        });
      }

      // Use calculated values for the sale (either no discrepancy or forceCreate is true)
      const finalSubtotal = forceCreate ? calculatedSubtotal : subtotal;
      const finalTotal = forceCreate ? calculatedTotal : total;
      const finalDiscountAmount = forceCreate
        ? calculatedDiscountAmount
        : subtotal * (discountPercentage / 100) + totalItemDiscount;

      // Validate staff member ID
      let staffMemberId;
      if (mongoose.Types.ObjectId.isValid(req.user._id)) {
        staffMemberId = req.user._id;
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid staff member ID",
        });
      }

      // Create the sale record
      const newSale = new Sale({
        store: storeDoc._id,
        invoiceNumber,
        customer: customerId,
        items: processedItems,
        subtotal: parseFloat(finalSubtotal.toFixed(2)),
        discount: discountPercentage, // Store percentage value
        discountAmount: parseFloat(finalDiscountAmount.toFixed(2)), // Store actual discount amount
        tax: tax || 0,
        total: parseFloat(finalTotal.toFixed(2)),
        finalTotal: parseFloat(finalTotal.toFixed(2)), // Initialize finalTotal same as total
        payment,
        staffMember: staffMemberId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const savedSale = await newSale.save({ session });

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      // Populate sale data for response
      const populatedSale = await Sale.findById(savedSale._id)
        .populate("store", "name")
        .populate("customer", "name email phoneNumber")
        .populate("staffMember", "firstName lastName")
        .populate({
          path: "items.product",
          select: "name genericName sku",
        })
        .populate({
          path: "items.batch",
          select: "batchNumber expiryDate manufacturingDate",
        });

      // Log successful sale creation

      return res.status(201).json({
        success: true,
        message: "Sale created successfully",
        data: populatedSale,
        // Include calculation info if there were discrepancies but sale was forced
        ...(forceCreate &&
          (subtotalDiscrepancy || totalDiscrepancy) && {
            calculationNote:
              "Sale created with system-calculated values due to price discrepancies",
            systemCalculatedValues: {
              subtotal: parseFloat(calculatedSubtotal.toFixed(2)),
              total: parseFloat(calculatedTotal.toFixed(2)),
            },
          }),
      });
    } catch (error) {
      // Rollback transaction on error
      await session.abortTransaction();
      session.endSession();

      console.error("Error creating sale:", error);

      // Return more specific error messages for common issues
      if (error.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: Object.values(error.errors).map((err) => err.message),
        });
      }

      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "Duplicate invoice number detected",
          error: "A sale with this invoice number already exists",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to create sale",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  }

  /**
   * Get all sales with filtering and pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllSales(req, res) {
    try {
      const page = parseInt(req.query.page);
      const limit = parseInt(req.query.limit);
      const skipIndex = (page - 1) * limit;

      // Build filter object
      const filter = {};

      // Store filter
      if (req.query.store) {
        if (!mongoose.Types.ObjectId.isValid(req.query.store)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid store ID" });
        }
        filter.store = req.query.store;

        // Check authorization if store filter is applied
        const store = await Store.findById(req.query.store);
        if (!store) {
          return res
            .status(404)
            .json({ success: false, message: "Store not found" });
        }

        const requestUserId = req.user.id;
        const isStoreOwner = store.owner.toString() === requestUserId;
        const isStoreStaff = store.staff.some(
          (staffId) => staffId.toString() === requestUserId
        );
        const isAdmin = req.user.role === "admin";

        if (!isStoreOwner && !isStoreStaff && !isAdmin) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to view sales for this store",
          });
        }
      } else if (req.user.role !== "admin") {
        // If no store filter and not admin, limit to associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        if (associatedStores.length === 0) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to view sales",
          });
        }

        filter.store = { $in: associatedStores.map((store) => store._id) };
      }

      // Customer filter
      if (req.query.customer) {
        if (!mongoose.Types.ObjectId.isValid(req.query.customer)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid customer ID" });
        }
        filter.customer = req.query.customer;
      }

      // Date range filter
      if (req.query.startDate) {
        const startDate = new Date(req.query.startDate);
        if (isNaN(startDate.getTime())) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid start date format" });
        }

        if (!filter.createdAt) filter.createdAt = {};
        filter.createdAt.$gte = startDate;
      }

      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        if (isNaN(endDate.getTime())) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid end date format" });
        }
        endDate.setHours(23, 59, 59, 999); // End of day

        if (!filter.createdAt) filter.createdAt = {};
        filter.createdAt.$lte = endDate;
      }

      // Invoice number filter
      if (req.query.invoiceNumber) {
        filter.invoiceNumber = {
          $regex: req.query.invoiceNumber,
          $options: "i",
        };
      }

      // Payment method filter
      if (req.query.paymentMethod) {
        filter["payment.method"] = req.query.paymentMethod;
      }

      // Payment status filter
      if (req.query.paymentStatus) {
        filter["payment.status"] = req.query.paymentStatus;
      }

      // Get total count for pagination
      const total = await Sale.countDocuments(filter);

      // Get sales with pagination and sorting
      const sort = { createdAt: -1 }; // Default sort newest first

      const sales = await Sale.find(filter)
        .populate("store", "name")
        .populate("customer", "name email")
        .populate("staffMember", "firstName lastName")
        .sort(sort)
        .skip(skipIndex)
        .limit(limit);

      return res.status(200).json({
        success: true,
        data: sales,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching sales:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch sales",
        error: error.message,
      });
    }
  }

  /**
   * Get sale by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSaleById(req, res) {
    try {
      const saleId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(saleId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid sale ID" });
      }

      const sale = await Sale.findById(saleId)
        .populate("store", "name address phoneNumber email")
        .populate("customer", "name email phoneNumber")
        .populate("staffMember", "firstName lastName")
        .populate({
          path: "items.product",
          select: "name genericName description",
        })
        .populate({
          path: "items.batch",
          select: "batchNumber expiryDate",
        });

      if (!sale) {
        return res
          .status(404)
          .json({ success: false, message: "Sale not found" });
      }

      // Check authorization
      const requestUserId = req.user.id;
      const store = await Store.findById(sale.store._id);

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
          message: "You do not have permission to view this sale",
        });
      }

      return res.status(200).json({
        success: true,
        data: sale,
      });
    } catch (error) {
      console.error("Error fetching sale:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch sale details",
        error: error.message,
      });
    }
  }

  /**
   * Update sale payment status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updatePaymentStatus(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const saleId = req.params.id;
      const { status, transactionId } = req.body;

      if (!mongoose.Types.ObjectId.isValid(saleId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid sale ID" });
      }

      // Check if sale exists
      const sale = await Sale.findById(saleId);
      if (!sale) {
        return res
          .status(404)
          .json({ success: false, message: "Sale not found" });
      }

      // Check authorization
      const requestUserId = req.user.id;
      const store = await Store.findById(sale.store);

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
          message: "You do not have permission to update this sale",
        });
      }

      // Validate payment status
      if (!["pending", "completed", "failed"].includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid payment status. Must be pending, completed, or failed.",
        });
      }

      // Update payment information
      const updateData = {
        "payment.status": status,
      };

      if (transactionId) {
        updateData["payment.transactionId"] = transactionId;
      }

      const updatedSale = await Sale.findByIdAndUpdate(
        saleId,
        { $set: updateData },
        { new: true, runValidators: true }
      )
        .populate("store", "name")
        .populate("customer", "name email")
        .populate("staffMember", "firstName lastName");

      return res.status(200).json({
        success: true,
        message: "Payment status updated successfully",
        data: updatedSale,
      });
    } catch (error) {
      console.error("Error updating payment status:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update payment status",
        error: error.message,
      });
    }
  }

  /**
   * Cancel sale and restore inventory
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async cancelSale(req, res) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const saleId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(saleId)) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ success: false, message: "Invalid sale ID" });
      }

      // Check if sale exists
      const sale = await Sale.findById(saleId).session(session);
      if (!sale) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ success: false, message: "Sale not found" });
      }

      // Check authorization - only store owner or admin can cancel sales
      const requestUserId = req.user.id;
      const store = await Store.findById(sale.store).session(session);

      if (!store) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ success: false, message: "Associated store not found" });
      }

      const isStoreOwner = store.owner.toString() === requestUserId;
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isAdmin) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: "Only store owners and administrators can cancel sales",
        });
      }

      // Check if sale can be canceled (e.g., not too old)
      const saleDate = new Date(sale.createdAt);
      const currentDate = new Date();
      const daysDifference = (currentDate - saleDate) / (1000 * 60 * 60 * 24);

      if (daysDifference > 7) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Sales older than 7 days cannot be canceled",
        });
      }

      // Restore inventory for each item
      for (const item of sale.items) {
        const batch = await Batch.findById(item.batch).session(session);
        if (batch) {
          batch.currentStock += item.quantity;
          await batch.save({ session });
        }
      }

      // Delete the sale
      await Sale.findByIdAndDelete(saleId).session(session);

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Sale canceled successfully and inventory restored",
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      console.error("Error canceling sale:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to cancel sale",
        error: error.message,
      });
    }
  }
  /**
   * Get sales reports with aggregation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async returnProducts(req, res) {
    // Use a transaction to ensure data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { saleId, storeId, returnedItems, reason } = req.body;

      // Validate sale ID
      if (!mongoose.Types.ObjectId.isValid(saleId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid sale ID",
        });
      }

      // Validate store ID if provided
      if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid store ID",
        });
      }

      // Validate returned items array
      if (
        !returnedItems ||
        !Array.isArray(returnedItems) ||
        returnedItems.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "At least one item must be specified for return",
        });
      }

      // Check for required fields in each returned item
      for (const item of returnedItems) {
        if (!item.productId || !item.batchId || !item.quantity) {
          return res.status(400).json({
            success: false,
            message:
              "Each returned item must include productId, batchId, and quantity",
          });
        }

        if (
          !mongoose.Types.ObjectId.isValid(item.productId) ||
          !mongoose.Types.ObjectId.isValid(item.batchId)
        ) {
          return res.status(400).json({
            success: false,
            message: "Invalid product or batch ID in returned items",
          });
        }

        if (typeof item.quantity !== "number" || item.quantity <= 0) {
          return res.status(400).json({
            success: false,
            message: "Quantity must be a positive number",
          });
        }
      }

      // Find the original sale
      const query = { _id: saleId };

      // Add store filter if provided
      if (storeId) {
        query.store = storeId;
      }

      const sale = await Sale.findOne(query).session(session);
      if (!sale) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: storeId
            ? "Sale not found in the specified store"
            : "Sale not found",
        });
      }

      // Check authorization
      const storeDoc = await Store.findById(sale.store).session(session);
      if (!storeDoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }

      // Only owner, admin, or authorized staff can process returns
      const requestUserId = req.user._id.toString();
      const isStoreOwner = storeDoc.owner.toString() === requestUserId;
      const isStoreStaff =
        storeDoc.staff &&
        storeDoc.staff.some((staffId) => staffId.toString() === requestUserId);
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isStoreStaff && !isAdmin) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to process returns for this store",
        });
      }

      // Check if sale is recent enough for returns (e.g., within 30 days)
      const saleDate = new Date(sale.createdAt);
      const currentDate = new Date();
      const daysDifference = (currentDate - saleDate) / (1000 * 60 * 60 * 24);

      const RETURN_WINDOW_DAYS = 30; // Can be adjusted based on store policy
      if (daysDifference > RETURN_WINDOW_DAYS) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Returns are only accepted within ${RETURN_WINDOW_DAYS} days of purchase`,
        });
      }

      // Process each returned item
      const returnSummary = [];
      let totalRefundAmount = 0;

      for (const returnItem of returnedItems) {
        // Find the item in the original sale
        const originalItem = sale.items.find(
          (item) =>
            item.product.toString() === returnItem.productId &&
            item.batch.toString() === returnItem.batchId
        );

        if (!originalItem) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Item with product ID ${returnItem.productId} and batch ID ${returnItem.batchId} not found in this sale`,
          });
        }

        // Check if return quantity is valid
        if (returnItem.quantity > originalItem.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Cannot return more than purchased quantity for product ID ${returnItem.productId}`,
          });
        }

        // Check if this item has already been fully returned in previous returns
        if (
          originalItem.returnedQuantity &&
          originalItem.returnedQuantity + returnItem.quantity >
            originalItem.quantity
        ) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Some quantity of product ID ${returnItem.productId} has already been returned`,
          });
        }

        // Update batch stock
        const batch = await Batch.findById(returnItem.batchId).session(session);
        if (!batch) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: `Batch with ID ${returnItem.batchId} not found`,
          });
        }

        // Increase the batch stock
        batch.currentStock += returnItem.quantity;
        await batch.save({ session });

        // Get product details for the summary
        const product = await Product.findById(returnItem.productId)
          .select("name genericName")
          .session(session);

        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: `Product with ID ${returnItem.productId} not found`,
          });
        }

        // Calculate refund amount for this item, considering the discount
        // Calculate the per-unit price after discount
        const discountPerUnit = originalItem.discount
          ? originalItem.discount / originalItem.quantity
          : 0;

        // Calculate the actual unit price the customer paid (with discount applied)
        const effectiveUnitPrice = originalItem.unitPrice - discountPerUnit;

        // Calculate total refund for the returned quantity
        const itemRefundAmount = effectiveUnitPrice * returnItem.quantity;

        totalRefundAmount += itemRefundAmount;

        // Update the original sale item with returned quantity
        if (!originalItem.returnedQuantity) {
          originalItem.returnedQuantity = 0;
        }
        originalItem.returnedQuantity += returnItem.quantity;

        // Add to return summary
        returnSummary.push({
          product: {
            id: product._id,
            name: product.name,
            genericName: product.genericName,
          },
          batch: batch.batchNumber || returnItem.batchId,
          returnedQuantity: returnItem.quantity,
          unitPrice: originalItem.unitPrice,
          discountPerUnit: discountPerUnit,
          effectiveUnitPrice: effectiveUnitPrice,
          refundAmount: itemRefundAmount,
        });
      }

      // Create return record in the sale
      if (!sale.returns) {
        sale.returns = [];
      }

      sale.returns.push({
        date: new Date(),
        items: returnedItems.map((item) => ({
          product: item.productId,
          batch: item.batchId,
          quantity: item.quantity,
        })),
        reason: reason || "No reason provided",
        processedBy: req.user._id,
        refundAmount: totalRefundAmount,
      });

      // Update sale totals
      sale.returnTotal = (sale.returnTotal || 0) + totalRefundAmount;
      sale.finalTotal = sale.total - (sale.returnTotal || 0);

      // Save the updated sale
      await sale.save({ session });

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // Return success response with updated data
      return res.status(200).json({
        success: true,
        message: "Products returned successfully",
        data: {
          invoiceNumber: sale.invoiceNumber,
          storeId: sale.store,
          returnSummary,
          totalRefundAmount,
          updatedSaleTotal: sale.finalTotal,
        },
      });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();

      console.error("Error processing return:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to process product return",
        error: error.message,
      });
    }
  }

  async getSaleByInvoiceNumber(req, res) {
    try {
      const { invoiceNumber } = req.params;
      const { storeId } = req.query;

      if (!invoiceNumber) {
        return res.status(400).json({
          success: false,
          message: "Invoice number is required",
        });
      }

      // Build query
      const query = { invoiceNumber };

      // Add store filter if provided
      if (storeId) {
        // Validate store ID
        if (!mongoose.Types.ObjectId.isValid(storeId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid store ID",
          });
        }
        query.store = storeId;
      }

      const sale = await Sale.findOne(query)
        .populate("store", "name address phoneNumber email")
        .populate("customer", "name email phoneNumber")
        .populate("staffMember", "firstName lastName")
        .populate({
          path: "items.product",
          select: "name genericName description",
        })
        .populate({
          path: "items.batch",
          select: "batchNumber expiryDate",
        });

      if (!sale) {
        return res.status(404).json({
          success: false,
          message: storeId
            ? "Sale not found with the provided invoice number in the specified store"
            : "Sale not found with the provided invoice number",
        });
      }

      // Check authorization
      const requestUserId = req.user.id;
      const store = await Store.findById(sale.store._id);

      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Associated store not found",
        });
      }

      const isStoreOwner = store.owner.toString() === requestUserId;
      const isStoreStaff =
        store.staff &&
        store.staff.some((staffId) => staffId.toString() === requestUserId);
      const isAdmin = req.user.role === "admin";

      if (!isStoreOwner && !isStoreStaff && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this sale",
        });
      }

      // Calculate remaining quantities and price details for each item
      const itemsWithDetails = sale.items.map((item) => {
        const remainingQuantity = item.quantity - (item.returnedQuantity || 0);
        const discountPerUnit = item.discount
          ? item.discount / item.quantity
          : 0;
        const effectiveUnitPrice = item.unitPrice - discountPerUnit;

        return {
          ...item.toObject(),
          remainingQuantity,
          discountPerUnit,
          effectiveUnitPrice,
          // Calculate potential refund amount for remaining quantity
          potentialRefundAmount: effectiveUnitPrice * remainingQuantity,
        };
      });

      const responseData = {
        ...sale.toObject(),
        items: itemsWithDetails,
        // Include additional return policy information
        returnPolicy: {
          daysLimit: 30,
          eligibleForReturn:
            (new Date() - new Date(sale.createdAt)) / (1000 * 60 * 60 * 24) <=
            30,
        },
      };

      return res.status(200).json({
        success: true,
        data: responseData,
      });
    } catch (error) {
      console.error("Error fetching sale by invoice:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch sale details",
        error: error.message,
      });
    }
  }

  /**
   * Generate sales reports (daily, weekly, monthly, yearly)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async generateSalesReport(req, res) {
    try {
      const {
        reportType,
        storeId,
        startDate,
        endDate,
        includeItemDetails = false,
      } = req.body;

      // Validate report type if no custom date range is provided
      if (
        !startDate &&
        !endDate &&
        !["daily", "weekly", "monthly", "yearly"].includes(reportType)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid report type. Must be daily, weekly, monthly, or yearly",
        });
      }

      // Validate store ID if provided
      if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid store ID",
        });
      }

      // Check authorization based on user role and store access
      if (storeId) {
        const store = await Store.findById(storeId);
        if (!store) {
          return res.status(404).json({
            success: false,
            message: "Store not found",
          });
        }

        // Verify user has permission to access this store's data
        const requestUserId = req.user.id;
        const isStoreOwner = store.owner.toString() === requestUserId;
        const isStoreStaff =
          store.staff &&
          store.staff.some((staffId) => staffId.toString() === requestUserId);
        const isAdmin = req.user.role === "admin";

        if (!isStoreOwner && !isStoreStaff && !isAdmin) {
          return res.status(403).json({
            success: false,
            message:
              "You do not have permission to generate reports for this store",
          });
        }
      } else if (req.user.role !== "admin") {
        // If no store specified and user is not admin, find their associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        if (associatedStores.length === 0) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to generate sales reports",
          });
        }
      }

      // Set date ranges based on custom dates or report type
      let fromDate, toDate;
      let groupByFormat;

      if (startDate && endDate) {
        // Use custom date range if provided, regardless of report type
        fromDate = new Date(startDate);
        toDate = new Date(endDate);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid date format for custom date range",
          });
        }

        // Validate logical date range
        if (fromDate > toDate) {
          return res.status(400).json({
            success: false,
            message: "Start date must be before end date",
          });
        }

        // Set beginning of day for start date and end of day for the end date
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);

        // Determine appropriate grouping based on the date range span
        const dayDifference = Math.ceil(
          (toDate - fromDate) / (1000 * 60 * 60 * 24)
        );

        if (dayDifference <= 2) {
          groupByFormat = "%Y-%m-%d %H:00"; // Group by hour for 1-2 days
        } else if (dayDifference <= 31) {
          groupByFormat = "%Y-%m-%d"; // Group by day for up to a month
        } else if (dayDifference <= 365) {
          groupByFormat = "%Y-%m-%d"; // Group by day for up to a year
        } else {
          groupByFormat = "%Y-%m"; // Group by month for > year
        }
      } else {
        // Calculate date range based on report type
        toDate = new Date(); // Current date as end date

        switch (reportType) {
          case "daily":
            // Past 24 hours or current day
            fromDate = new Date(toDate);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            groupByFormat = "%Y-%m-%d %H:00"; // Group by hour
            break;

          case "weekly":
            // Past 7 days
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 7);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            groupByFormat = "%Y-%m-%d"; // Group by day
            break;

          case "monthly":
            // Past 30 days (fixed as per requirement)
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 30);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            groupByFormat = "%Y-%m-%d"; // Group by day
            break;

          case "yearly":
            // Past 365 days
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 365);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            groupByFormat = "%Y-%m"; // Group by month
            break;

          default:
            // Default to last 7 days if no valid report type
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 7);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            groupByFormat = "%Y-%m-%d"; // Group by day
        }
      }

      // Build match stage for aggregation
      const matchStage = {
        createdAt: { $gte: fromDate, $lte: toDate },
      };

      // Add store filter if provided
      if (storeId) {
        matchStage.store = new mongoose.Types.ObjectId(storeId);
      } else if (req.user.role !== "admin") {
        // If not admin and no store specified, limit to associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        matchStage.store = {
          $in: associatedStores.map((store) => store._id),
        };
      }

      // Base aggregation pipeline
      const basePipeline = [
        { $match: matchStage },
        {
          $lookup: {
            from: "stores",
            localField: "store",
            foreignField: "_id",
            as: "storeData",
          },
        },
        { $unwind: { path: "$storeData", preserveNullAndEmptyArrays: true } },
      ];

      // Group stage based on report type
      let groupStage;
      const baseGroup = {
        storeName: { $first: "$storeData.name" },
        date: { $first: "$createdAt" },
        count: { $sum: 1 },
        subtotal: { $sum: "$subtotal" },
        discount: { $sum: "$discount" },
        tax: { $sum: "$tax" },
        total: { $sum: "$total" },
        returns: { $sum: "$returnTotal" },
        finalTotal: { $sum: "$finalTotal" },
        paymentMethods: {
          $push: "$payment.method",
        },
      };

      // Determine the appropriate group stage based on report type or custom date range
      const effectiveReportType = startDate && endDate ? "custom" : reportType;

      if (effectiveReportType === "daily") {
        groupStage = {
          _id: {
            hour: { $hour: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            store: "$store",
          },
          ...baseGroup,
        };
      } else if (
        effectiveReportType === "weekly" ||
        effectiveReportType === "monthly" ||
        effectiveReportType === "custom"
      ) {
        groupStage = {
          _id: {
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            store: "$store",
          },
          ...baseGroup,
        };
      } else {
        // yearly or default
        groupStage = {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            store: "$store",
          },
          ...baseGroup,
        };
      }

      const aggregationPipeline = [...basePipeline, { $group: groupStage }];

      // Add payment method analytics
      aggregationPipeline.push({
        $addFields: {
          paymentMethodStats: {
            cash: {
              $size: {
                $filter: {
                  input: "$paymentMethods",
                  as: "method",
                  cond: { $eq: ["$$method", "cash"] },
                },
              },
            },
            card: {
              $size: {
                $filter: {
                  input: "$paymentMethods",
                  as: "method",
                  cond: { $eq: ["$$method", "card"] },
                },
              },
            },
            mobileBanking: {
              $size: {
                $filter: {
                  input: "$paymentMethods",
                  as: "method",
                  cond: { $eq: ["$$method", "mobileBanking"] },
                },
              },
            },
          },
        },
      });

      // Cleanup and format the output
      aggregationPipeline.push({
        $project: {
          _id: 0,
          store: "$_id.store",
          storeName: 1,
          date: 1,
          day: "$_id.day",
          month: "$_id.month",
          year: "$_id.year",
          hour: "$_id.hour",
          salesCount: "$count",
          subtotal: { $round: ["$subtotal", 2] },
          discount: { $round: ["$discount", 2] },
          tax: { $round: ["$tax", 2] },
          total: { $round: ["$total", 2] },
          returns: { $round: ["$returns", 2] },
          finalTotal: { $round: ["$finalTotal", 2] },
          netSales: { $round: [{ $subtract: ["$total", "$returns"] }, 2] },
          averageSale: {
            $round: [
              {
                $divide: [
                  "$total",
                  { $cond: [{ $eq: ["$count", 0] }, 1, "$count"] },
                ],
              },
              2,
            ],
          },
          paymentMethodStats: 1,
        },
      });

      // Sort results based on report type
      if (effectiveReportType === "daily") {
        aggregationPipeline.push({
          $sort: { year: 1, month: 1, day: 1, hour: 1, store: 1 },
        });
      } else if (
        effectiveReportType === "weekly" ||
        effectiveReportType === "monthly" ||
        effectiveReportType === "custom"
      ) {
        aggregationPipeline.push({
          $sort: { year: 1, month: 1, day: 1, store: 1 },
        });
      } else {
        // yearly or default
        aggregationPipeline.push({ $sort: { year: 1, month: 1, store: 1 } });
      }

      // Add pagination to prevent memory issues with large datasets
      aggregationPipeline.push({ $limit: 1000 }); // Reasonable limit to prevent memory issues

      // Execute the aggregation
      const salesReport = await Sale.aggregate(aggregationPipeline);

      // Additional product-level analytics if requested
      let productReport = [];
      if (includeItemDetails) {
        const productPipeline = [
          { $match: matchStage },
          { $unwind: "$items" },
          {
            $lookup: {
              from: "products",
              localField: "items.product",
              foreignField: "_id",
              as: "productData",
            },
          },
          { $unwind: "$productData" },
          {
            $group: {
              _id: {
                product: "$items.product",
                store: "$store",
              },
              productName: { $first: "$productData.name" },
              genericName: { $first: "$productData.genericName" },
              quantitySold: { $sum: "$items.quantity" },
              quantityReturned: {
                $sum: { $ifNull: ["$items.returnedQuantity", 0] },
              },
              revenue: {
                $sum: { $multiply: ["$items.unitPrice", "$items.quantity"] },
              },
              discount: { $sum: "$items.discount" },
              sales: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              productId: "$_id.product",
              storeId: "$_id.store",
              productName: 1,
              genericName: 1,
              quantitySold: 1,
              quantityReturned: 1,
              netQuantity: {
                $subtract: ["$quantitySold", "$quantityReturned"],
              },
              revenue: { $round: ["$revenue", 2] },
              discount: { $round: ["$discount", 2] },
              netRevenue: {
                $round: [{ $subtract: ["$revenue", "$discount"] }, 2],
              },
              salesContaining: "$sales",
              averagePrice: {
                $round: [{ $divide: ["$revenue", "$quantitySold"] }, 2],
              },
            },
          },
          { $sort: { netRevenue: -1 } },
          { $limit: 1000 }, // Limit to prevent memory issues
        ];

        productReport = await Sale.aggregate(productPipeline);
      }

      // Calculate summary statistics
      const summary = salesReport.reduce(
        (acc, day) => {
          acc.totalSales += day.salesCount;
          acc.totalRevenue += day.total;
          acc.totalReturns += day.returns;
          acc.netRevenue += day.finalTotal;
          acc.totalDiscount += day.discount;
          acc.totalTax += day.tax;

          // Count payment methods
          acc.paymentMethods.cash += day.paymentMethodStats.cash;
          acc.paymentMethods.card += day.paymentMethodStats.card;
          acc.paymentMethods.mobileBanking +=
            day.paymentMethodStats.mobileBanking;

          return acc;
        },
        {
          totalSales: 0,
          totalRevenue: 0,
          totalReturns: 0,
          netRevenue: 0,
          totalDiscount: 0,
          totalTax: 0,
          paymentMethods: {
            cash: 0,
            card: 0,
            mobileBanking: 0,
          },
        }
      );

      // Calculate percentages for payment methods
      if (summary.totalSales > 0) {
        summary.paymentMethodPercentages = {
          cash: parseFloat(
            ((summary.paymentMethods.cash / summary.totalSales) * 100).toFixed(
              2
            )
          ),
          card: parseFloat(
            ((summary.paymentMethods.card / summary.totalSales) * 100).toFixed(
              2
            )
          ),
          mobileBanking: parseFloat(
            (
              (summary.paymentMethods.mobileBanking / summary.totalSales) *
              100
            ).toFixed(2)
          ),
        };
      } else {
        summary.paymentMethodPercentages = {
          cash: 0,
          card: 0,
          mobileBanking: 0,
        };
      }

      // Round summary values to 2 decimal places
      summary.totalRevenue = parseFloat(summary.totalRevenue.toFixed(2));
      summary.totalReturns = parseFloat(summary.totalReturns.toFixed(2));
      summary.netRevenue = parseFloat(summary.netRevenue.toFixed(2));
      summary.totalDiscount = parseFloat(summary.totalDiscount.toFixed(2));
      summary.totalTax = parseFloat(summary.totalTax.toFixed(2));

      // Add average sale value
      summary.averageSaleValue =
        summary.totalSales > 0
          ? parseFloat((summary.totalRevenue / summary.totalSales).toFixed(2))
          : 0;

      // Calculate date range display for the report title
      const dateRangeDisplay = {
        start: fromDate.toISOString().split("T")[0],
        end: toDate.toISOString().split("T")[0],
        reportType: startDate && endDate ? "custom" : reportType,
      };

      return res.status(200).json({
        success: true,
        report: {
          title: `${
            startDate && endDate
              ? "Custom"
              : reportType.charAt(0).toUpperCase() + reportType.slice(1)
          } Sales Report`,
          dateRange: dateRangeDisplay,
          summary,
          detail: salesReport,
          productAnalytics: includeItemDetails ? productReport : undefined,
        },
      });
    } catch (error) {
      console.error("Error generating sales report:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate sales report",
        error:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : error.message,
      });
    }
  }

  /**
   * Export sales report to CSV format
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  /**
   * Export sales report to CSV format
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async exportSalesReport(req, res) {
    try {
      // First, generate the report using direct database access
      const {
        reportType,
        storeId,
        startDate,
        endDate,
        includeItemDetails = true, // Always include item details for exports
      } = req.body;

      // Validate report type
      if (!["daily", "weekly", "monthly", "yearly"].includes(reportType)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid report type. Must be daily, weekly, monthly, or yearly",
        });
      }

      // Validate store ID if provided
      if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid store ID",
        });
      }

      // Check authorization based on user role and store access
      if (storeId) {
        const store = await Store.findById(storeId);
        if (!store) {
          return res.status(404).json({
            success: false,
            message: "Store not found",
          });
        }

        // Verify user has permission to access this store's data
        const requestUserId = req.user.id;
        const isStoreOwner = store.owner.toString() === requestUserId;
        const isStoreStaff =
          store.staff &&
          store.staff.some((staffId) => staffId.toString() === requestUserId);
        const isAdmin = req.user.role === "admin";

        if (!isStoreOwner && !isStoreStaff && !isAdmin) {
          return res.status(403).json({
            success: false,
            message:
              "You do not have permission to generate reports for this store",
          });
        }
      } else if (req.user.role !== "admin") {
        // If no store specified and user is not admin, find their associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        if (associatedStores.length === 0) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to generate sales reports",
          });
        }
      }

      // Set date ranges based on report type
      let fromDate, toDate;
      let groupByFormat;

      if (startDate && endDate) {
        // Use custom date range if provided
        fromDate = new Date(startDate);
        toDate = new Date(endDate);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid date format for custom date range",
          });
        }

        // Set end of day for the end date
        toDate.setHours(23, 59, 59, 999);
      } else {
        // Calculate date range based on report type
        toDate = new Date(); // Current date as end date

        switch (reportType) {
          case "daily":
            // Past 24 hours or current day
            fromDate = new Date(toDate);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            groupByFormat = "%Y-%m-%d %H:00"; // Group by hour
            break;

          case "weekly":
            // Past 7 days or current week
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 7);
            groupByFormat = "%Y-%m-%d"; // Group by day
            break;

          case "monthly":
            // Past 30 days or current month
            fromDate = new Date(toDate);
            fromDate.setDate(1); // First day of current month
            groupByFormat = "%Y-%m-%d"; // Group by day
            break;

          case "yearly":
            // Past 365 days or current year
            fromDate = new Date(toDate);
            fromDate.setMonth(0, 1); // January 1st of current year
            groupByFormat = "%Y-%m"; // Group by month
            break;
        }
      }

      // Build match stage for aggregation
      const matchStage = {
        createdAt: { $gte: fromDate, $lte: toDate },
      };

      // Add store filter if provided
      if (storeId) {
        matchStage.store = new mongoose.Types.ObjectId(storeId);
      } else if (req.user.role !== "admin") {
        // If not admin and no store specified, limit to associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        matchStage.store = {
          $in: associatedStores.map((store) => store._id),
        };
      }

      // Base aggregation pipeline
      const basePipeline = [
        { $match: matchStage },
        {
          $lookup: {
            from: "stores",
            localField: "store",
            foreignField: "_id",
            as: "storeData",
          },
        },
        { $unwind: { path: "$storeData", preserveNullAndEmptyArrays: true } },
      ];

      // Group stage based on report type
      let groupStage;
      if (reportType === "daily") {
        groupStage = {
          _id: {
            hour: { $hour: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            store: "$store",
          },
          storeName: { $first: "$storeData.name" },
          date: { $first: "$createdAt" },
          count: { $sum: 1 },
          subtotal: { $sum: "$subtotal" },
          discount: { $sum: "$discount" },
          tax: { $sum: "$tax" },
          total: { $sum: "$total" },
          returns: { $sum: "$returnTotal" },
          finalTotal: { $sum: "$finalTotal" },
          paymentMethods: {
            $push: "$payment.method",
          },
        };
      } else if (reportType === "weekly" || reportType === "monthly") {
        groupStage = {
          _id: {
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            store: "$store",
          },
          storeName: { $first: "$storeData.name" },
          date: { $first: "$createdAt" },
          count: { $sum: 1 },
          subtotal: { $sum: "$subtotal" },
          discount: { $sum: "$discount" },
          tax: { $sum: "$tax" },
          total: { $sum: "$total" },
          returns: { $sum: "$returnTotal" },
          finalTotal: { $sum: "$finalTotal" },
          paymentMethods: {
            $push: "$payment.method",
          },
        };
      } else {
        // yearly
        groupStage = {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            store: "$store",
          },
          storeName: { $first: "$storeData.name" },
          date: { $first: "$createdAt" },
          count: { $sum: 1 },
          subtotal: { $sum: "$subtotal" },
          discount: { $sum: "$discount" },
          tax: { $sum: "$tax" },
          total: { $sum: "$total" },
          returns: { $sum: "$returnTotal" },
          finalTotal: { $sum: "$finalTotal" },
          paymentMethods: {
            $push: "$payment.method",
          },
        };
      }

      const aggregationPipeline = [...basePipeline, { $group: groupStage }];

      // Add payment method analytics
      aggregationPipeline.push({
        $addFields: {
          paymentMethodStats: {
            cash: {
              $size: {
                $filter: {
                  input: "$paymentMethods",
                  as: "method",
                  cond: { $eq: ["$$method", "cash"] },
                },
              },
            },
            card: {
              $size: {
                $filter: {
                  input: "$paymentMethods",
                  as: "method",
                  cond: { $eq: ["$$method", "card"] },
                },
              },
            },
            mobileBanking: {
              $size: {
                $filter: {
                  input: "$paymentMethods",
                  as: "method",
                  cond: { $eq: ["$$method", "mobileBanking"] },
                },
              },
            },
          },
        },
      });

      // Cleanup and format the output
      aggregationPipeline.push({
        $project: {
          _id: 0,
          store: "$_id.store",
          storeName: 1,
          date: 1,
          day: "$_id.day",
          month: "$_id.month",
          year: "$_id.year",
          hour: "$_id.hour",
          salesCount: "$count",
          subtotal: { $round: ["$subtotal", 2] },
          discount: { $round: ["$discount", 2] },
          tax: { $round: ["$tax", 2] },
          total: { $round: ["$total", 2] },
          returns: { $round: ["$returns", 2] },
          finalTotal: { $round: ["$finalTotal", 2] },
          netSales: { $round: [{ $subtract: ["$total", "$returns"] }, 2] },
          averageSale: {
            $round: [
              {
                $divide: [
                  "$total",
                  { $cond: [{ $eq: ["$count", 0] }, 1, "$count"] },
                ],
              },
              2,
            ],
          },
          paymentMethodStats: 1,
        },
      });

      // Sort results
      if (reportType === "daily") {
        aggregationPipeline.push({
          $sort: { year: 1, month: 1, day: 1, hour: 1, store: 1 },
        });
      } else if (reportType === "weekly" || reportType === "monthly") {
        aggregationPipeline.push({
          $sort: { year: 1, month: 1, day: 1, store: 1 },
        });
      } else {
        // yearly
        aggregationPipeline.push({ $sort: { year: 1, month: 1, store: 1 } });
      }

      // Execute the aggregation
      const salesReport = await Sale.aggregate(aggregationPipeline);

      // Additional product-level analytics if requested
      let productReport = [];
      if (includeItemDetails) {
        const productPipeline = [
          { $match: matchStage },
          { $unwind: "$items" },
          {
            $lookup: {
              from: "products",
              localField: "items.product",
              foreignField: "_id",
              as: "productData",
            },
          },
          { $unwind: "$productData" },
          {
            $group: {
              _id: {
                product: "$items.product",
                store: "$store",
              },
              productName: { $first: "$productData.name" },
              genericName: { $first: "$productData.genericName" },
              quantitySold: { $sum: "$items.quantity" },
              quantityReturned: {
                $sum: { $ifNull: ["$items.returnedQuantity", 0] },
              },
              revenue: {
                $sum: { $multiply: ["$items.unitPrice", "$items.quantity"] },
              },
              discount: { $sum: "$items.discount" },
              sales: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              productId: "$_id.product",
              storeId: "$_id.store",
              productName: 1,
              genericName: 1,
              quantitySold: 1,
              quantityReturned: 1,
              netQuantity: {
                $subtract: ["$quantitySold", "$quantityReturned"],
              },
              revenue: { $round: ["$revenue", 2] },
              discount: { $round: ["$discount", 2] },
              netRevenue: {
                $round: [{ $subtract: ["$revenue", "$discount"] }, 2],
              },
              salesContaining: "$sales",
              averagePrice: {
                $round: [{ $divide: ["$revenue", "$quantitySold"] }, 2],
              },
            },
          },
          { $sort: { netRevenue: -1 } },
        ];

        productReport = await Sale.aggregate(productPipeline);
      }

      // Calculate summary statistics
      const summary = salesReport.reduce(
        (acc, day) => {
          acc.totalSales += day.salesCount;
          acc.totalRevenue += day.total;
          acc.totalReturns += day.returns;
          acc.netRevenue += day.finalTotal;
          acc.totalDiscount += day.discount;
          acc.totalTax += day.tax;

          // Count payment methods
          acc.paymentMethods.cash += day.paymentMethodStats.cash;
          acc.paymentMethods.card += day.paymentMethodStats.card;
          acc.paymentMethods.mobileBanking +=
            day.paymentMethodStats.mobileBanking;

          return acc;
        },
        {
          totalSales: 0,
          totalRevenue: 0,
          totalReturns: 0,
          netRevenue: 0,
          totalDiscount: 0,
          totalTax: 0,
          paymentMethods: {
            cash: 0,
            card: 0,
            mobileBanking: 0,
          },
        }
      );

      // Calculate percentages for payment methods
      if (summary.totalSales > 0) {
        summary.paymentMethodPercentages = {
          cash: parseFloat(
            ((summary.paymentMethods.cash / summary.totalSales) * 100).toFixed(
              2
            )
          ),
          card: parseFloat(
            ((summary.paymentMethods.card / summary.totalSales) * 100).toFixed(
              2
            )
          ),
          mobileBanking: parseFloat(
            (
              (summary.paymentMethods.mobileBanking / summary.totalSales) *
              100
            ).toFixed(2)
          ),
        };
      } else {
        summary.paymentMethodPercentages = {
          cash: 0,
          card: 0,
          mobileBanking: 0,
        };
      }

      // Round summary values to 2 decimal places
      summary.totalRevenue = parseFloat(summary.totalRevenue.toFixed(2));
      summary.totalReturns = parseFloat(summary.totalReturns.toFixed(2));
      summary.netRevenue = parseFloat(summary.netRevenue.toFixed(2));
      summary.totalDiscount = parseFloat(summary.totalDiscount.toFixed(2));
      summary.totalTax = parseFloat(summary.totalTax.toFixed(2));

      // Add average sale value
      summary.averageSaleValue =
        summary.totalSales > 0
          ? parseFloat((summary.totalRevenue / summary.totalSales).toFixed(2))
          : 0;

      // Calculate date range display for the report title
      const dateRangeDisplay = {
        start: fromDate.toISOString().split("T")[0],
        end: toDate.toISOString().split("T")[0],
        reportType,
      };

      // Create the report object
      const report = {
        title: `${
          reportType.charAt(0).toUpperCase() + reportType.slice(1)
        } Sales Report`,
        dateRange: dateRangeDisplay,
        summary,
        detail: salesReport,
        productAnalytics: includeItemDetails ? productReport : undefined,
      };

      // Now handle the export to CSV
      const exportFormat = req.body.format || "csv";

      if (exportFormat === "csv") {
        // Format dates correctly for filename
        const startDate = report.dateRange.start.replace(/\//g, "-");
        const endDate = report.dateRange.end.replace(/\//g, "-");
        const safeTitle = report.title
          ? report.title.replace(/\s+/g, "_")
          : "Sales_Report";

        // Set response headers for CSV download
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}_${startDate}_to_${endDate}.csv"`
        );

        // CSV header row
        let csvContent = "Date,";

        if (report.dateRange.reportType === "daily") {
          csvContent += "Hour,";
        }

        csvContent +=
          "Store,Sales Count,Subtotal,Discount,Tax,Total Sales,Returns,Net Sales,Cash Payments,Card Payments,Mobile Banking\n";

        // CSV data rows
        if (Array.isArray(report.detail) && report.detail.length > 0) {
          report.detail.forEach((row) => {
            // Format date based on report type
            let dateStr;
            if (report.dateRange.reportType === "yearly") {
              dateStr = `${row.year}-${String(row.month).padStart(2, "0")}`;
            } else {
              dateStr = `${row.year}-${String(row.month).padStart(
                2,
                "0"
              )}-${String(row.day).padStart(2, "0")}`;
            }

            csvContent += `${dateStr},`;

            // Add hour for daily reports
            if (report.dateRange.reportType === "daily") {
              csvContent += `${String(row.hour || 0).padStart(2, "0")}:00,`;
            }

            // Handle potentially undefined values with defaults
            csvContent += `"${(row.storeName || "Unknown").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `${row.salesCount || 0},`;
            csvContent += `${row.subtotal || 0},`;
            csvContent += `${row.discount || 0},`;
            csvContent += `${row.tax || 0},`;
            csvContent += `${row.total || 0},`;
            csvContent += `${row.returns || 0},`;
            csvContent += `${row.finalTotal || 0},`;

            // Handle potentially undefined payment stats
            const paymentStats = row.paymentMethodStats || {};
            csvContent += `${paymentStats.cash || 0},`;
            csvContent += `${paymentStats.card || 0},`;
            csvContent += `${paymentStats.mobileBanking || 0}\n`;
          });
        } else {
          csvContent += "No data available for the selected period\n";
        }

        // Add summary section if summary exists
        if (report.summary) {
          csvContent += "\nSummary,,,,,,,,,\n";
          csvContent += `Total Sales,${
            report.summary.totalSales || 0
          },,,,,,,,\n`;
          csvContent += `Total Revenue,${
            report.summary.totalRevenue || 0
          },,,,,,,,\n`;
          csvContent += `Total Returns,${
            report.summary.totalReturns || 0
          },,,,,,,,\n`;
          csvContent += `Net Revenue,${
            report.summary.netRevenue || 0
          },,,,,,,,\n`;
          csvContent += `Total Discount,${
            report.summary.totalDiscount || 0
          },,,,,,,,\n`;
          csvContent += `Total Tax,${report.summary.totalTax || 0},,,,,,,,\n`;
          csvContent += `Average Sale Value,${
            report.summary.averageSaleValue || 0
          },,,,,,,,\n`;

          // Handle payment methods safely
          const paymentMethods = report.summary.paymentMethods || {};
          const paymentPercentages =
            report.summary.paymentMethodPercentages || {};

          csvContent += `Cash Payments,${paymentMethods.cash || 0} (${
            paymentPercentages.cash || 0
          }%),,,,,,,,\n`;
          csvContent += `Card Payments,${paymentMethods.card || 0} (${
            paymentPercentages.card || 0
          }%),,,,,,,,\n`;
          csvContent += `Mobile Banking,${paymentMethods.mobileBanking || 0} (${
            paymentPercentages.mobileBanking || 0
          }%),,,,,,,,\n`;
        }

        // Add product analytics section if available
        if (
          report.productAnalytics &&
          Array.isArray(report.productAnalytics) &&
          report.productAnalytics.length > 0
        ) {
          csvContent += "\nProduct Analytics,,,,,,,,,\n";
          csvContent +=
            "Product Name,Generic Name,Quantity Sold,Quantity Returned,Net Quantity,Revenue,Discount,Net Revenue,Sales Count,Average Price\n";

          report.productAnalytics.forEach((product) => {
            // Escape quotes in string fields to handle products with commas or quotes
            csvContent += `"${(product.productName || "").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `"${(product.genericName || "").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `${product.quantitySold || 0},`;
            csvContent += `${product.quantityReturned || 0},`;
            csvContent += `${product.netQuantity || 0},`;
            csvContent += `${product.revenue || 0},`;
            csvContent += `${product.discount || 0},`;
            csvContent += `${product.netRevenue || 0},`;
            csvContent += `${product.salesContaining || 0},`;
            csvContent += `${product.averagePrice || 0}\n`;
          });
        }

        // Send CSV response
        return res.send(csvContent);
      } else {
        // For future implementation of other formats like PDF, Excel, etc.
        return res.status(400).json({
          success: false,
          message: `Export format '${exportFormat}' is not supported yet. Please use 'csv'.`,
        });
      }
    } catch (error) {
      console.error("Error exporting sales report:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to export sales report",
        error: error.message,
      });
    }
  }

  /**
   * Generate profit and revenue reports (daily, weekly, monthly, yearly)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async generateProfitReport(req, res) {
    let session = null;
    try {
      const {
        reportType,
        storeId,
        startDate,
        endDate,
        includeProductDetails = false,
      } = req.body;

      // Validate report type if provided (make it optional when custom dates are provided)
      if (
        reportType &&
        !["daily", "weekly", "monthly", "yearly"].includes(reportType)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid report type. Must be daily, weekly, monthly, or yearly",
        });
      }

      // Validate store ID if provided
      if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid store ID",
        });
      }

      // Check authorization based on user role and store access
      let associatedStoreIds = [];
      if (storeId) {
        const store = await Store.findById(storeId);
        if (!store) {
          return res.status(404).json({
            success: false,
            message: "Store not found",
          });
        }

        // Verify user has permission to access this store's data
        const requestUserId = req.user.id;
        const isStoreOwner = store.owner.toString() === requestUserId;
        const isStoreStaff =
          store.staff &&
          store.staff.some((staffId) => staffId.toString() === requestUserId);
        const isAdmin = req.user.role === "admin";

        if (!isStoreOwner && !isStoreStaff && !isAdmin) {
          return res.status(403).json({
            success: false,
            message:
              "You do not have permission to generate reports for this store",
          });
        }

        associatedStoreIds = [storeId];
      } else if (req.user.role !== "admin") {
        // If no store specified and user is not admin, find their associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        if (associatedStores.length === 0) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to generate profit reports",
          });
        }

        associatedStoreIds = associatedStores.map((store) => store._id);
      }

      // Set date ranges based on custom dates or report type
      let fromDate, toDate;
      let effectiveReportType = reportType; // Track the effective report type for formatting

      if (startDate && endDate) {
        // Use custom date range if provided - this takes priority over reportType
        fromDate = new Date(startDate);
        toDate = new Date(endDate);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid date format for custom date range",
          });
        }

        // Set beginning of day for start date
        fromDate.setHours(0, 0, 0, 0);

        // Set end of day for the end date
        toDate.setHours(23, 59, 59, 999);

        // Determine an appropriate report type based on the date range if none provided
        if (!reportType) {
          const daysDifference = Math.ceil(
            (toDate - fromDate) / (1000 * 60 * 60 * 24)
          );

          if (daysDifference <= 1) {
            effectiveReportType = "daily";
          } else if (daysDifference <= 7) {
            effectiveReportType = "weekly";
          } else if (daysDifference <= 31) {
            effectiveReportType = "monthly";
          } else {
            effectiveReportType = "yearly";
          }
        }
      } else {
        // Calculate date range based on report type
        toDate = new Date(); // Current date as end date
        toDate.setHours(23, 59, 59, 999); // End of day

        switch (reportType) {
          case "daily":
            // Current day
            fromDate = new Date(toDate);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            break;

          case "weekly":
            // Past 7 days
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 6); // 7 days including today
            fromDate.setHours(0, 0, 0, 0); // Start of day
            break;

          case "monthly":
            // Last 30 days (not current month)
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 29); // 30 days including today
            fromDate.setHours(0, 0, 0, 0); // Start of day
            break;

          case "yearly":
            // Last 365 days
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 364); // 365 days including today
            fromDate.setHours(0, 0, 0, 0); // Start of day
            break;

          default:
            // Default to last 30 days if no report type specified
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 29);
            fromDate.setHours(0, 0, 0, 0);
            effectiveReportType = "monthly";
            break;
        }
      }

      // Build match stage for aggregation
      const matchStage = {
        createdAt: { $gte: fromDate, $lte: toDate },
      };

      // Add store filter if provided
      if (storeId) {
        matchStage.store = new mongoose.Types.ObjectId(storeId);
      } else if (req.user.role !== "admin" && associatedStoreIds.length > 0) {
        // If not admin and no store specified, limit to associated stores
        matchStage.store = {
          $in: associatedStoreIds.map((id) => new mongoose.Types.ObjectId(id)),
        };
      }

      // Start MongoDB session for transactions (if needed later)
      session = await mongoose.startSession();

      // Get sales data with batch and product information for profit calculation
      const salesData = await Sale.aggregate([
        { $match: matchStage },
        // Lookup store info
        {
          $lookup: {
            from: "stores",
            localField: "store",
            foreignField: "_id",
            as: "storeData",
          },
        },
        { $unwind: { path: "$storeData", preserveNullAndEmptyArrays: true } },
        // Unwind items array to process each item
        { $unwind: "$items" },
        // Lookup batch information to get purchase price
        {
          $lookup: {
            from: "batches",
            localField: "items.batch",
            foreignField: "_id",
            as: "batchData",
          },
        },
        { $unwind: "$batchData" },
        // Lookup product information
        {
          $lookup: {
            from: "products",
            localField: "items.product",
            foreignField: "_id",
            as: "productData",
          },
        },
        { $unwind: "$productData" },
        // Project needed fields - updated to match schema
        {
          $project: {
            date: "$createdAt",
            store: "$store",
            storeName: "$storeData.name",
            invoiceNumber: "$invoiceNumber",
            productId: "$items.product",
            productName: "$productData.name",
            genericName: "$productData.genericName",
            batchId: "$items.batch",
            batchNumber: "$batchData.batchNumber",
            // Updated field names to match schema
            purchasePrice: "$batchData.costPrice", // Changed from unitPurchasePrice to costPrice
            sellingPrice: "$items.unitPrice",
            quantity: "$items.quantity",
            returnedQuantity: { $ifNull: ["$items.returnedQuantity", 0] },
            discount: { $ifNull: ["$items.discount", 0] },
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            hour: { $hour: "$createdAt" },
            // Added additional fields that might be useful
            paymentMethod: "$payment.method",
            paymentStatus: "$payment.status",
            staffMember: "$staffMember",
            // Include return information
            hasReturns: { $gt: [{ $size: { $ifNull: ["$returns", []] } }, 0] },
          },
        },
        // Calculate profit metrics for each item
        {
          $addFields: {
            netQuantity: { $subtract: ["$quantity", "$returnedQuantity"] },
            discountPerUnit: {
              $cond: [
                { $eq: ["$quantity", 0] },
                0,
                { $divide: ["$discount", "$quantity"] },
              ],
            },
          },
        },
        {
          $addFields: {
            effectiveUnitPrice: {
              $subtract: ["$sellingPrice", "$discountPerUnit"],
            },
            unitProfit: { $subtract: ["$sellingPrice", "$purchasePrice"] },
            unitProfitAfterDiscount: {
              $subtract: [
                { $subtract: ["$sellingPrice", "$discountPerUnit"] },
                "$purchasePrice",
              ],
            },
          },
        },
        {
          $addFields: {
            revenue: { $multiply: ["$effectiveUnitPrice", "$netQuantity"] },
            cost: { $multiply: ["$purchasePrice", "$netQuantity"] },
            profit: { $multiply: ["$unitProfitAfterDiscount", "$netQuantity"] },
            profitMargin: {
              $cond: [
                { $eq: ["$effectiveUnitPrice", 0] },
                0,
                {
                  $multiply: [
                    {
                      $divide: [
                        "$unitProfitAfterDiscount",
                        "$effectiveUnitPrice",
                      ],
                    },
                    100,
                  ],
                },
              ],
            },
          },
        },
      ]).session(session);

      // If no sales data found
      if (!salesData || !salesData.length) {
        // End session before returning response
        await session.endSession();

        return res.status(200).json({
          success: true,
          message: "No sales data available for the selected period",
          report: {
            title: `${
              effectiveReportType.charAt(0).toUpperCase() +
              effectiveReportType.slice(1)
            } Profit and Revenue Report`,
            dateRange: {
              start: fromDate.toISOString().split("T")[0],
              end: toDate.toISOString().split("T")[0],
              reportType: effectiveReportType,
            },
            summary: {
              totalRevenue: 0,
              totalCost: 0,
              totalProfit: 0,
              averageProfitMargin: 0,
              returnRate: 0,
              totalItems: 0,
              totalReturns: 0,
              netItems: 0,
            },
            detail: [],
            productAnalytics: [],
          },
        });
      }

      // Group data by time period for the requested report type
      let groupedData = [];
      let timeFormat = "";

      // Determine the time grouping based on effective report type and date range
      switch (effectiveReportType) {
        case "daily":
          timeFormat = "hour";
          // Group by hour
          const hourlyGroups = {};

          salesData.forEach((item) => {
            const key = `${item.year}-${String(item.month).padStart(
              2,
              "0"
            )}-${String(item.day).padStart(2, "0")}-${String(
              item.hour
            ).padStart(2, "0")}`;

            if (!hourlyGroups[key]) {
              hourlyGroups[key] = {
                date: item.date,
                year: item.year,
                month: item.month,
                day: item.day,
                hour: item.hour,
                storeName: item.storeName,
                revenue: 0,
                cost: 0,
                profit: 0,
                totalQuantity: 0,
                returnedQuantity: 0,
                items: [],
              };
            }

            hourlyGroups[key].revenue += item.revenue;
            hourlyGroups[key].cost += item.cost;
            hourlyGroups[key].profit += item.profit;
            hourlyGroups[key].totalQuantity += item.quantity;
            hourlyGroups[key].returnedQuantity += item.returnedQuantity;

            // For item details
            if (includeProductDetails) {
              hourlyGroups[key].items.push({
                productId: item.productId,
                productName: item.productName,
                genericName: item.genericName,
                batchId: item.batchId,
                batchNumber: item.batchNumber,
                quantity: item.quantity,
                returnedQuantity: item.returnedQuantity,
                netQuantity: item.netQuantity,
                revenue: item.revenue,
                cost: item.cost,
                profit: item.profit,
                profitMargin: item.profitMargin,
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
              });
            }
          });

          groupedData = Object.values(hourlyGroups);
          break;

        case "weekly":
        case "monthly":
          timeFormat = "day";
          // Group by day
          const dailyGroups = {};

          salesData.forEach((item) => {
            const key = `${item.year}-${String(item.month).padStart(
              2,
              "0"
            )}-${String(item.day).padStart(2, "0")}`;

            if (!dailyGroups[key]) {
              dailyGroups[key] = {
                date: item.date,
                year: item.year,
                month: item.month,
                day: item.day,
                storeName: item.storeName,
                revenue: 0,
                cost: 0,
                profit: 0,
                totalQuantity: 0,
                returnedQuantity: 0,
                items: [],
              };
            }

            dailyGroups[key].revenue += item.revenue;
            dailyGroups[key].cost += item.cost;
            dailyGroups[key].profit += item.profit;
            dailyGroups[key].totalQuantity += item.quantity;
            dailyGroups[key].returnedQuantity += item.returnedQuantity;

            if (includeProductDetails) {
              dailyGroups[key].items.push({
                productId: item.productId,
                productName: item.productName,
                genericName: item.genericName,
                batchId: item.batchId,
                batchNumber: item.batchNumber,
                quantity: item.quantity,
                returnedQuantity: item.returnedQuantity,
                netQuantity: item.netQuantity,
                revenue: item.revenue,
                cost: item.cost,
                profit: item.profit,
                profitMargin: item.profitMargin,
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
              });
            }
          });

          groupedData = Object.values(dailyGroups);
          break;

        case "yearly":
          timeFormat = "month";
          // Group by month
          const monthlyGroups = {};

          salesData.forEach((item) => {
            const key = `${item.year}-${String(item.month).padStart(2, "0")}`;

            if (!monthlyGroups[key]) {
              monthlyGroups[key] = {
                date: item.date,
                year: item.year,
                month: item.month,
                storeName: item.storeName,
                revenue: 0,
                cost: 0,
                profit: 0,
                totalQuantity: 0,
                returnedQuantity: 0,
                items: [],
              };
            }

            monthlyGroups[key].revenue += item.revenue;
            monthlyGroups[key].cost += item.cost;
            monthlyGroups[key].profit += item.profit;
            monthlyGroups[key].totalQuantity += item.quantity;
            monthlyGroups[key].returnedQuantity += item.returnedQuantity;

            if (includeProductDetails) {
              monthlyGroups[key].items.push({
                productId: item.productId,
                productName: item.productName,
                genericName: item.genericName,
                batchId: item.batchId,
                batchNumber: item.batchNumber,
                quantity: item.quantity,
                returnedQuantity: item.returnedQuantity,
                netQuantity: item.netQuantity,
                revenue: item.revenue,
                cost: item.cost,
                profit: item.profit,
                profitMargin: item.profitMargin,
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
              });
            }
          });

          groupedData = Object.values(monthlyGroups);
          break;
      }

      // Calculate additional metrics for each group and format data
      const formattedData = groupedData.map((group) => {
        // Calculate profit margin percentage
        const profitMarginPct =
          group.revenue > 0 ? (group.profit / group.revenue) * 100 : 0;

        // Calculate return rate
        const returnRatePct =
          group.totalQuantity > 0
            ? (group.returnedQuantity / group.totalQuantity) * 100
            : 0;

        // Format date label based on report type
        let dateLabel;
        if (timeFormat === "hour") {
          dateLabel = `${group.year}-${String(group.month).padStart(
            2,
            "0"
          )}-${String(group.day).padStart(2, "0")} ${String(
            group.hour
          ).padStart(2, "0")}:00`;
        } else if (timeFormat === "day") {
          dateLabel = `${group.year}-${String(group.month).padStart(
            2,
            "0"
          )}-${String(group.day).padStart(2, "0")}`;
        } else {
          dateLabel = `${group.year}-${String(group.month).padStart(2, "0")}`;
        }

        return {
          dateLabel,
          timeUnit: timeFormat,
          ...group,
          revenue: parseFloat(group.revenue.toFixed(2)),
          cost: parseFloat(group.cost.toFixed(2)),
          profit: parseFloat(group.profit.toFixed(2)),
          profitMargin: parseFloat(profitMarginPct.toFixed(2)),
          returnRate: parseFloat(returnRatePct.toFixed(2)),
          items: includeProductDetails
            ? group.items.map((item) => ({
                ...item,
                revenue: parseFloat(item.revenue.toFixed(2)),
                cost: parseFloat(item.cost?.toFixed(2)),
                profit: parseFloat(item.profit?.toFixed(2)),
                profitMargin: parseFloat(item.profitMargin?.toFixed(2)),
              }))
            : undefined,
        };
      });

      // Sort data by date
      formattedData.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.month !== b.month) return a.month - b.month;
        if (a.day !== b.day) return a.day - b.day;
        if (a.hour !== b.hour) return a.hour - b.hour;
        return 0;
      });

      // Generate product-level analytics
      let productAnalytics = [];
      if (includeProductDetails) {
        const productMap = {};

        salesData.forEach((item) => {
          const productId = item.productId.toString();

          if (!productMap[productId]) {
            productMap[productId] = {
              productId: item.productId,
              productName: item.productName,
              genericName: item.genericName,
              totalQuantity: 0,
              returnedQuantity: 0,
              netQuantity: 0,
              revenue: 0,
              cost: 0,
              profit: 0,
              batchDetails: [],
            };
          }

          // Aggregate product level data
          productMap[productId].totalQuantity += item.quantity;
          productMap[productId].returnedQuantity += item.returnedQuantity;
          productMap[productId].netQuantity += item.netQuantity;
          productMap[productId].revenue += item.revenue;
          productMap[productId].cost += item.cost;
          productMap[productId].profit += item.profit;

          // Track batch level data
          const batchId = item.batchId.toString();
          const existingBatch = productMap[productId].batchDetails.find(
            (b) => b.batchId.toString() === batchId
          );

          if (existingBatch) {
            existingBatch.quantity += item.quantity;
            existingBatch.returnedQuantity += item.returnedQuantity;
            existingBatch.netQuantity += item.netQuantity;
            existingBatch.revenue += item.revenue;
            existingBatch.cost += item.cost;
            existingBatch.profit += item.profit;
          } else {
            productMap[productId].batchDetails.push({
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              purchasePrice: item.purchasePrice,
              sellingPrice: item.sellingPrice,
              quantity: item.quantity,
              returnedQuantity: item.returnedQuantity,
              netQuantity: item.netQuantity,
              revenue: item.revenue,
              cost: item.cost,
              profit: item.profit,
            });
          }
        });

        // Convert map to array and calculate metrics
        productAnalytics = Object.values(productMap).map((product) => {
          const profitMargin =
            product.revenue > 0 ? (product.profit / product.revenue) * 100 : 0;
          const returnRate =
            product.totalQuantity > 0
              ? (product.returnedQuantity / product.totalQuantity) * 100
              : 0;

          return {
            ...product,
            profitMargin: parseFloat(profitMargin.toFixed(2)),
            returnRate: parseFloat(returnRate.toFixed(2)),
            revenue: parseFloat(product.revenue.toFixed(2)),
            cost: parseFloat(product.cost.toFixed(2)),
            profit: parseFloat(product.profit.toFixed(2)),
            batchDetails: product.batchDetails.map((batch) => ({
              ...batch,
              revenue: parseFloat(batch.revenue.toFixed(2)),
              cost: parseFloat(batch.cost.toFixed(2)),
              profit: parseFloat(batch.profit.toFixed(2)),
              profitMargin:
                batch.revenue > 0
                  ? parseFloat(
                      ((batch.profit / batch.revenue) * 100).toFixed(2)
                    )
                  : 0,
            })),
          };
        });

        // Sort products by profit (highest first)
        productAnalytics.sort((a, b) => b.profit - a.profit);
      }

      // Calculate overall summary
      const summary = salesData.reduce(
        (acc, item) => {
          acc.totalRevenue += item.revenue;
          acc.totalCost += item.cost;
          acc.totalProfit += item.profit;
          acc.totalQuantity += item.quantity;
          acc.totalReturnedQuantity += item.returnedQuantity;
          acc.profitSumForAverage += item.profitMargin * item.revenue; // Weighted profit margin
          acc.revenueSumForAverage += item.revenue;
          return acc;
        },
        {
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          totalQuantity: 0,
          totalReturnedQuantity: 0,
          profitSumForAverage: 0,
          revenueSumForAverage: 0,
        }
      );

      // Calculate averages and percentages
      const averageProfitMargin =
        summary.revenueSumForAverage > 0
          ? summary.profitSumForAverage / summary.revenueSumForAverage
          : 0;
      const returnRate =
        summary.totalQuantity > 0
          ? (summary.totalReturnedQuantity / summary.totalQuantity) * 100
          : 0;

      const formattedSummary = {
        totalRevenue: parseFloat(summary.totalRevenue.toFixed(2)),
        totalCost: parseFloat(summary.totalCost.toFixed(2)),
        totalProfit: parseFloat(summary.totalProfit.toFixed(2)),
        grossProfitMargin: parseFloat(
          ((summary.totalProfit / summary.totalRevenue) * 100 || 0).toFixed(2)
        ),
        averageProfitMargin: parseFloat(averageProfitMargin.toFixed(2)),
        returnRate: parseFloat(returnRate.toFixed(2)),
        totalItems: summary.totalQuantity,
        totalReturns: summary.totalReturnedQuantity,
        netItems: summary.totalQuantity - summary.totalReturnedQuantity,
      };

      // Added payment method analysis
      let paymentMethodAnalytics = null;
      if (includeProductDetails) {
        const paymentSummary = salesData.reduce((acc, item) => {
          const method = item.paymentMethod || "unknown";
          if (!acc[method]) {
            acc[method] = {
              method,
              count: 0,
              revenue: 0,
              profit: 0,
              items: 0,
            };
          }
          acc[method].count += 1;
          acc[method].revenue += item.revenue;
          acc[method].profit += item.profit;
          acc[method].items += item.netQuantity;
          return acc;
        }, {});

        paymentMethodAnalytics = Object.values(paymentSummary).map((pm) => ({
          ...pm,
          revenue: parseFloat(pm.revenue.toFixed(2)),
          profit: parseFloat(pm.profit.toFixed(2)),
          profitMargin: parseFloat(
            ((pm.profit / pm.revenue) * 100 || 0).toFixed(2)
          ),
          percentOfTotal: parseFloat(
            ((pm.revenue / summary.totalRevenue) * 100 || 0).toFixed(2)
          ),
        }));
      }

      // Prepare the final report
      const report = {
        title: `${
          effectiveReportType.charAt(0).toUpperCase() +
          effectiveReportType.slice(1)
        } Profit and Revenue Report`,
        dateRange: {
          start: fromDate.toISOString().split("T")[0],
          end: toDate.toISOString().split("T")[0],
          reportType: effectiveReportType,
        },
        summary: formattedSummary,
        detail: formattedData,
        productAnalytics: includeProductDetails ? productAnalytics : undefined,
        paymentMethodAnalytics: includeProductDetails
          ? paymentMethodAnalytics
          : undefined,
      };

      // End the session
      await session.endSession();

      return res.status(200).json({
        success: true,
        report,
      });
    } catch (error) {
      // Abort transaction on error
      if (session) {
        await session.endSession();
      }

      console.error("Error generating profit report:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate profit and revenue report",
        error: error.message,
      });
    }
  }

  /**
   * Export profit and revenue report to CSV format
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async exportProfitReport(req, res) {
    let session = null;
    try {
      const {
        reportType,
        storeId,
        startDate,
        endDate,
        format = "csv",
        includeProductDetails = true, // Always include product details for exports
      } = req.body;

      // Validate report type
      if (!["daily", "weekly", "monthly", "yearly"].includes(reportType)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid report type. Must be daily, weekly, monthly, or yearly",
        });
      }

      // Validate store ID if provided
      if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid store ID",
        });
      }

      // Check authorization based on user role and store access
      let associatedStoreIds = [];
      if (storeId) {
        const store = await Store.findById(storeId);
        if (!store) {
          return res.status(404).json({
            success: false,
            message: "Store not found",
          });
        }

        // Verify user has permission to access this store's data
        const requestUserId = req.user.id;
        const isStoreOwner = store.owner.toString() === requestUserId;
        const isStoreStaff =
          store.staff &&
          store.staff.some((staffId) => staffId.toString() === requestUserId);
        const isAdmin = req.user.role === "admin";

        if (!isStoreOwner && !isStoreStaff && !isAdmin) {
          return res.status(403).json({
            success: false,
            message:
              "You do not have permission to export reports for this store",
          });
        }

        associatedStoreIds = [storeId];
      } else if (req.user.role !== "admin") {
        // If no store specified and user is not admin, find their associated stores
        const associatedStores = await Store.find({
          $or: [{ owner: req.user.id }, { staff: req.user.id }],
        }).select("_id");

        if (associatedStores.length === 0) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to export profit reports",
          });
        }

        associatedStoreIds = associatedStores.map((store) => store._id);
      }

      // Set date ranges based on report type
      let fromDate, toDate;

      if (startDate && endDate) {
        // Use custom date range if provided
        fromDate = new Date(startDate);
        toDate = new Date(endDate);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid date format for custom date range",
          });
        }

        // Set end of day for the end date
        toDate.setHours(23, 59, 59, 999);
      } else {
        // Calculate date range based on report type
        toDate = new Date(); // Current date as end date

        switch (reportType) {
          case "daily":
            // Current day
            fromDate = new Date(toDate);
            fromDate.setHours(0, 0, 0, 0); // Start of day
            break;

          case "weekly":
            // Past 7 days
            fromDate = new Date(toDate);
            fromDate.setDate(toDate.getDate() - 7);
            break;

          case "monthly":
            // Current month
            fromDate = new Date(toDate);
            fromDate.setDate(1); // First day of current month
            break;

          case "yearly":
            // Current year
            fromDate = new Date(toDate);
            fromDate.setMonth(0, 1); // January 1st of current year
            break;
        }
      }

      // Build match stage for aggregation
      const matchStage = {
        createdAt: { $gte: fromDate, $lte: toDate },
      };

      // Add store filter if provided
      if (storeId) {
        matchStage.store = new mongoose.Types.ObjectId(storeId);
      } else if (req.user.role !== "admin" && associatedStoreIds.length > 0) {
        // If not admin and no store specified, limit to associated stores
        matchStage.store = {
          $in: associatedStoreIds.map((id) => new mongoose.Types.ObjectId(id)),
        };
      }

      // Start MongoDB session for transactions (if needed later)
      session = await mongoose.startSession();

      // Get sales data with batch and product information for profit calculation
      const salesData = await Sale.aggregate([
        { $match: matchStage },
        // Lookup store info
        {
          $lookup: {
            from: "stores",
            localField: "store",
            foreignField: "_id",
            as: "storeData",
          },
        },
        { $unwind: { path: "$storeData", preserveNullAndEmptyArrays: true } },
        // Unwind items array to process each item
        { $unwind: "$items" },
        // Lookup batch information to get purchase price
        {
          $lookup: {
            from: "batches",
            localField: "items.batch",
            foreignField: "_id",
            as: "batchData",
          },
        },
        { $unwind: "$batchData" },
        // Lookup product information
        {
          $lookup: {
            from: "products",
            localField: "items.product",
            foreignField: "_id",
            as: "productData",
          },
        },
        { $unwind: "$productData" },
        // Project needed fields
        {
          $project: {
            date: "$createdAt",
            store: "$store",
            storeName: "$storeData.name",
            invoiceNumber: "$invoiceNumber",
            productId: "$items.product",
            productName: "$productData.name",
            genericName: "$productData.genericName",
            batchId: "$items.batch",
            batchNumber: "$batchData.batchNumber",
            purchasePrice: "$batchData.costPrice",
            sellingPrice: "$items.unitPrice",
            quantity: "$items.quantity",
            returnedQuantity: { $ifNull: ["$items.returnedQuantity", 0] },
            discount: { $ifNull: ["$items.discount", 0] },
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            hour: { $hour: "$createdAt" },
            paymentMethod: "$payment.method",
            paymentStatus: "$payment.status",
            staffMember: "$staffMember",
            hasReturns: { $gt: [{ $size: { $ifNull: ["$returns", []] } }, 0] },
          },
        },
        // Calculate profit metrics for each item
        {
          $addFields: {
            netQuantity: { $subtract: ["$quantity", "$returnedQuantity"] },
            discountPerUnit: {
              $cond: [
                { $eq: ["$quantity", 0] },
                0,
                { $divide: ["$discount", "$quantity"] },
              ],
            },
          },
        },
        {
          $addFields: {
            effectiveUnitPrice: {
              $subtract: ["$sellingPrice", "$discountPerUnit"],
            },
            unitProfit: { $subtract: ["$sellingPrice", "$purchasePrice"] },
            unitProfitAfterDiscount: {
              $subtract: [
                { $subtract: ["$sellingPrice", "$discountPerUnit"] },
                "$purchasePrice",
              ],
            },
          },
        },
        {
          $addFields: {
            revenue: { $multiply: ["$effectiveUnitPrice", "$netQuantity"] },
            cost: { $multiply: ["$purchasePrice", "$netQuantity"] },
            profit: { $multiply: ["$unitProfitAfterDiscount", "$netQuantity"] },
            profitMargin: {
              $cond: [
                { $eq: ["$effectiveUnitPrice", 0] },
                0,
                {
                  $multiply: [
                    {
                      $divide: [
                        "$unitProfitAfterDiscount",
                        "$effectiveUnitPrice",
                      ],
                    },
                    100,
                  ],
                },
              ],
            },
          },
        },
      ]).session(session);

      // If no sales data found
      if (!salesData || !salesData.length) {
        // End session before returning response
        await session.endSession();

        // Set report title
        const reportTitle = `${
          reportType.charAt(0).toUpperCase() + reportType.slice(1)
        } Profit and Revenue Report`;

        if (format === "csv") {
          // Format dates for filename
          const startDateStr = fromDate.toISOString().split("T")[0];
          const endDateStr = toDate.toISOString().split("T")[0];
          const safeTitle = reportTitle.replace(/\s+/g, "_");

          // Set response headers for CSV download
          res.setHeader("Content-Type", "text/csv");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeTitle}_${startDateStr}_to_${endDateStr}.csv"`
          );

          // Create empty CSV
          let csvContent = "No sales data available for the selected period";
          return res.send(csvContent);
        } else {
          return res.status(400).json({
            success: false,
            message: `${format.toUpperCase()} export format is not supported yet`,
          });
        }
      }

      // Group data by time period for the requested report type
      let groupedData = [];
      let timeFormat = "";

      switch (reportType) {
        case "daily":
          timeFormat = "hour";
          // Group by hour
          const hourlyGroups = {};

          salesData.forEach((item) => {
            const key = `${item.year}-${String(item.month).padStart(
              2,
              "0"
            )}-${String(item.day).padStart(2, "0")}-${String(
              item.hour
            ).padStart(2, "0")}`;

            if (!hourlyGroups[key]) {
              hourlyGroups[key] = {
                date: item.date,
                year: item.year,
                month: item.month,
                day: item.day,
                hour: item.hour,
                storeName: item.storeName,
                revenue: 0,
                cost: 0,
                profit: 0,
                totalQuantity: 0,
                returnedQuantity: 0,
                items: [],
              };
            }

            hourlyGroups[key].revenue += item.revenue;
            hourlyGroups[key].cost += item.cost;
            hourlyGroups[key].profit += item.profit;
            hourlyGroups[key].totalQuantity += item.quantity;
            hourlyGroups[key].returnedQuantity += item.returnedQuantity;

            // For item details
            hourlyGroups[key].items.push({
              productId: item.productId,
              productName: item.productName,
              genericName: item.genericName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              quantity: item.quantity,
              returnedQuantity: item.returnedQuantity,
              netQuantity: item.netQuantity,
              revenue: item.revenue,
              cost: item.cost,
              profit: item.profit,
              profitMargin: item.profitMargin,
              paymentMethod: item.paymentMethod,
              paymentStatus: item.paymentStatus,
            });
          });

          groupedData = Object.values(hourlyGroups);
          break;

        case "weekly":
        case "monthly":
          timeFormat = "day";
          // Group by day
          const dailyGroups = {};

          salesData.forEach((item) => {
            const key = `${item.year}-${String(item.month).padStart(
              2,
              "0"
            )}-${String(item.day).padStart(2, "0")}`;

            if (!dailyGroups[key]) {
              dailyGroups[key] = {
                date: item.date,
                year: item.year,
                month: item.month,
                day: item.day,
                storeName: item.storeName,
                revenue: 0,
                cost: 0,
                profit: 0,
                totalQuantity: 0,
                returnedQuantity: 0,
                items: [],
              };
            }

            dailyGroups[key].revenue += item.revenue;
            dailyGroups[key].cost += item.cost;
            dailyGroups[key].profit += item.profit;
            dailyGroups[key].totalQuantity += item.quantity;
            dailyGroups[key].returnedQuantity += item.returnedQuantity;

            dailyGroups[key].items.push({
              productId: item.productId,
              productName: item.productName,
              genericName: item.genericName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              quantity: item.quantity,
              returnedQuantity: item.returnedQuantity,
              netQuantity: item.netQuantity,
              revenue: item.revenue,
              cost: item.cost,
              profit: item.profit,
              profitMargin: item.profitMargin,
              paymentMethod: item.paymentMethod,
              paymentStatus: item.paymentStatus,
            });
          });

          groupedData = Object.values(dailyGroups);
          break;

        case "yearly":
          timeFormat = "month";
          // Group by month
          const monthlyGroups = {};

          salesData.forEach((item) => {
            const key = `${item.year}-${String(item.month).padStart(2, "0")}`;

            if (!monthlyGroups[key]) {
              monthlyGroups[key] = {
                date: item.date,
                year: item.year,
                month: item.month,
                storeName: item.storeName,
                revenue: 0,
                cost: 0,
                profit: 0,
                totalQuantity: 0,
                returnedQuantity: 0,
                items: [],
              };
            }

            monthlyGroups[key].revenue += item.revenue;
            monthlyGroups[key].cost += item.cost;
            monthlyGroups[key].profit += item.profit;
            monthlyGroups[key].totalQuantity += item.quantity;
            monthlyGroups[key].returnedQuantity += item.returnedQuantity;

            monthlyGroups[key].items.push({
              productId: item.productId,
              productName: item.productName,
              genericName: item.genericName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              quantity: item.quantity,
              returnedQuantity: item.returnedQuantity,
              netQuantity: item.netQuantity,
              revenue: item.revenue,
              cost: item.cost,
              profit: item.profit,
              profitMargin: item.profitMargin,
              paymentMethod: item.paymentMethod,
              paymentStatus: item.paymentStatus,
            });
          });

          groupedData = Object.values(monthlyGroups);
          break;
      }

      // Calculate additional metrics for each group and format data
      const formattedData = groupedData.map((group) => {
        // Calculate profit margin percentage
        const profitMarginPct =
          group.revenue > 0 ? (group.profit / group.revenue) * 100 : 0;

        // Calculate return rate
        const returnRatePct =
          group.totalQuantity > 0
            ? (group.returnedQuantity / group.totalQuantity) * 100
            : 0;

        // Format date label based on report type
        let dateLabel;
        if (timeFormat === "hour") {
          dateLabel = `${group.year}-${String(group.month).padStart(
            2,
            "0"
          )}-${String(group.day).padStart(2, "0")} ${String(
            group.hour
          ).padStart(2, "0")}:00`;
        } else if (timeFormat === "day") {
          dateLabel = `${group.year}-${String(group.month).padStart(
            2,
            "0"
          )}-${String(group.day).padStart(2, "0")}`;
        } else {
          dateLabel = `${group.year}-${String(group.month).padStart(2, "0")}`;
        }

        return {
          dateLabel,
          timeUnit: timeFormat,
          ...group,
          revenue: parseFloat(group.revenue.toFixed(2)),
          cost: parseFloat(group.cost.toFixed(2)),
          profit: parseFloat(group.profit.toFixed(2)),
          profitMargin: parseFloat(profitMarginPct.toFixed(2)),
          returnRate: parseFloat(returnRatePct.toFixed(2)),
          items: group.items.map((item) => ({
            ...item,
            revenue: parseFloat(item.revenue.toFixed(2)),
            cost: parseFloat(item.cost?.toFixed(2)),
            profit: parseFloat(item.profit?.toFixed(2)),
            profitMargin: parseFloat(item.profitMargin?.toFixed(2)),
          })),
        };
      });

      // Sort data by date
      formattedData.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.month !== b.month) return a.month - b.month;
        if (a.day !== b.day) return a.day - b.day;
        if (a.hour !== b.hour) return a.hour - b.hour;
        return 0;
      });

      // Generate product-level analytics
      const productMap = {};

      salesData.forEach((item) => {
        const productId = item.productId.toString();

        if (!productMap[productId]) {
          productMap[productId] = {
            productId: item.productId,
            productName: item.productName,
            genericName: item.genericName,
            totalQuantity: 0,
            returnedQuantity: 0,
            netQuantity: 0,
            revenue: 0,
            cost: 0,
            profit: 0,
            batchDetails: [],
          };
        }

        // Aggregate product level data
        productMap[productId].totalQuantity += item.quantity;
        productMap[productId].returnedQuantity += item.returnedQuantity;
        productMap[productId].netQuantity += item.netQuantity;
        productMap[productId].revenue += item.revenue;
        productMap[productId].cost += item.cost;
        productMap[productId].profit += item.profit;

        // Track batch level data
        const batchId = item.batchId.toString();
        const existingBatch = productMap[productId].batchDetails.find(
          (b) => b.batchId.toString() === batchId
        );

        if (existingBatch) {
          existingBatch.quantity += item.quantity;
          existingBatch.returnedQuantity += item.returnedQuantity;
          existingBatch.netQuantity += item.netQuantity;
          existingBatch.revenue += item.revenue;
          existingBatch.cost += item.cost;
          existingBatch.profit += item.profit;
        } else {
          productMap[productId].batchDetails.push({
            batchId: item.batchId,
            batchNumber: item.batchNumber,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
            quantity: item.quantity,
            returnedQuantity: item.returnedQuantity,
            netQuantity: item.netQuantity,
            revenue: item.revenue,
            cost: item.cost,
            profit: item.profit,
          });
        }
      });

      // Convert map to array and calculate metrics
      const productAnalytics = Object.values(productMap).map((product) => {
        const profitMargin =
          product.revenue > 0 ? (product.profit / product.revenue) * 100 : 0;
        const returnRate =
          product.totalQuantity > 0
            ? (product.returnedQuantity / product.totalQuantity) * 100
            : 0;

        return {
          ...product,
          profitMargin: parseFloat(profitMargin.toFixed(2)),
          returnRate: parseFloat(returnRate.toFixed(2)),
          revenue: parseFloat(product.revenue.toFixed(2)),
          cost: parseFloat(product.cost.toFixed(2)),
          profit: parseFloat(product.profit.toFixed(2)),
          batchDetails: product.batchDetails.map((batch) => ({
            ...batch,
            revenue: parseFloat(batch.revenue.toFixed(2)),
            cost: parseFloat(batch.cost.toFixed(2)),
            profit: parseFloat(batch.profit.toFixed(2)),
            profitMargin:
              batch.revenue > 0
                ? parseFloat(((batch.profit / batch.revenue) * 100).toFixed(2))
                : 0,
          })),
        };
      });

      // Sort products by profit (highest first)
      productAnalytics.sort((a, b) => b.profit - a.profit);

      // Calculate overall summary
      const summary = salesData.reduce(
        (acc, item) => {
          acc.totalRevenue += item.revenue;
          acc.totalCost += item.cost;
          acc.totalProfit += item.profit;
          acc.totalQuantity += item.quantity;
          acc.totalReturnedQuantity += item.returnedQuantity;
          acc.profitSumForAverage += item.profitMargin * item.revenue; // Weighted profit margin
          acc.revenueSumForAverage += item.revenue;
          return acc;
        },
        {
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          totalQuantity: 0,
          totalReturnedQuantity: 0,
          profitSumForAverage: 0,
          revenueSumForAverage: 0,
        }
      );

      // Calculate averages and percentages
      const averageProfitMargin =
        summary.revenueSumForAverage > 0
          ? summary.profitSumForAverage / summary.revenueSumForAverage
          : 0;
      const returnRate =
        summary.totalQuantity > 0
          ? (summary.totalReturnedQuantity / summary.totalQuantity) * 100
          : 0;

      const formattedSummary = {
        totalRevenue: parseFloat(summary.totalRevenue.toFixed(2)),
        totalCost: parseFloat(summary.totalCost.toFixed(2)),
        totalProfit: parseFloat(summary.totalProfit.toFixed(2)),
        grossProfitMargin: parseFloat(
          ((summary.totalProfit / summary.totalRevenue) * 100 || 0).toFixed(2)
        ),
        averageProfitMargin: parseFloat(averageProfitMargin.toFixed(2)),
        returnRate: parseFloat(returnRate.toFixed(2)),
        totalItems: summary.totalQuantity,
        totalReturns: summary.totalReturnedQuantity,
        netItems: summary.totalQuantity - summary.totalReturnedQuantity,
      };

      // Payment method analysis
      const paymentSummary = salesData.reduce((acc, item) => {
        const method = item.paymentMethod || "unknown";
        if (!acc[method]) {
          acc[method] = {
            method,
            count: 0,
            revenue: 0,
            profit: 0,
            items: 0,
          };
        }
        acc[method].count += 1;
        acc[method].revenue += item.revenue;
        acc[method].profit += item.profit;
        acc[method].items += item.netQuantity;
        return acc;
      }, {});

      const paymentMethodAnalytics = Object.values(paymentSummary).map(
        (pm) => ({
          ...pm,
          revenue: parseFloat(pm.revenue.toFixed(2)),
          profit: parseFloat(pm.profit.toFixed(2)),
          profitMargin: parseFloat(
            ((pm.profit / pm.revenue) * 100 || 0).toFixed(2)
          ),
          percentOfTotal: parseFloat(
            ((pm.revenue / summary.totalRevenue) * 100 || 0).toFixed(2)
          ),
        })
      );

      // Set report title
      const reportTitle = `${
        reportType.charAt(0).toUpperCase() + reportType.slice(1)
      } Profit and Revenue Report`;

      // Export based on format
      if (format === "csv") {
        // Format dates for filename
        const startDateStr = fromDate.toISOString().split("T")[0];
        const endDateStr = toDate.toISOString().split("T")[0];
        const safeTitle = reportTitle.replace(/\s+/g, "_");

        // Set response headers for CSV download
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}_${startDateStr}_to_${endDateStr}.csv"`
        );

        // Determine headers based on report type
        let csvHeaders = "Date,";
        if (reportType === "daily") {
          csvHeaders += "Hour,";
        }
        csvHeaders +=
          "Store,Revenue,Cost,Profit,Profit Margin %,Return Rate %,Total Quantity,Returned Quantity,Net Quantity\n";

        // CSV data rows
        let csvContent = csvHeaders;

        if (formattedData.length > 0) {
          formattedData.forEach((row) => {
            csvContent += `${row.dateLabel},`;

            // Add hour for daily reports if not already in dateLabel
            if (reportType === "daily" && !row.dateLabel.includes(":")) {
              csvContent += `${String(row.hour || 0).padStart(2, "0")}:00,`;
            }

            // Add the rest of the data
            csvContent += `"${(row.storeName || "Unknown").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `${row.revenue || 0},`;
            csvContent += `${row.cost || 0},`;
            csvContent += `${row.profit || 0},`;
            csvContent += `${row.profitMargin || 0},`;
            csvContent += `${row.returnRate || 0},`;
            csvContent += `${row.totalQuantity || 0},`;
            csvContent += `${row.returnedQuantity || 0},`;
            csvContent += `${row.totalQuantity - row.returnedQuantity || 0}\n`;
          });
        } else {
          csvContent += "No data available for the selected period\n";
        }

        // Add summary section
        csvContent += "\nSummary,,,,,,,,,\n";
        csvContent += `Total Revenue,${
          formattedSummary.totalRevenue || 0
        },,,,,,,,\n`;
        csvContent += `Total Cost,${formattedSummary.totalCost || 0},,,,,,,,\n`;
        csvContent += `Total Profit,${
          formattedSummary.totalProfit || 0
        },,,,,,,,\n`;
        csvContent += `Gross Profit Margin,${
          formattedSummary.grossProfitMargin || 0
        }%,,,,,,,,\n`;
        csvContent += `Average Profit Margin,${
          formattedSummary.averageProfitMargin || 0
        }%,,,,,,,,\n`;
        csvContent += `Return Rate,${
          formattedSummary.returnRate || 0
        }%,,,,,,,,\n`;
        csvContent += `Total Items,${
          formattedSummary.totalItems || 0
        },,,,,,,,\n`;
        csvContent += `Total Returns,${
          formattedSummary.totalReturns || 0
        },,,,,,,,\n`;
        csvContent += `Net Items,${formattedSummary.netItems || 0},,,,,,,,\n`;

        // Add payment method analytics section
        if (paymentMethodAnalytics.length > 0) {
          csvContent += "\nPayment Method Analytics,,,,,,,,,\n";
          csvContent +=
            "Payment Method,Count,Revenue,Profit,Profit Margin %,% of Total Revenue,Items Sold\n";

          paymentMethodAnalytics.forEach((payment) => {
            csvContent += `"${(payment.method || "Unknown").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `${payment.count || 0},`;
            csvContent += `${payment.revenue || 0},`;
            csvContent += `${payment.profit || 0},`;
            csvContent += `${payment.profitMargin || 0},`;
            csvContent += `${payment.percentOfTotal || 0},`;
            csvContent += `${payment.items || 0}\n`;
          });
        }

        // Add product analytics section
        if (productAnalytics.length > 0) {
          csvContent += "\nProduct Analytics,,,,,,,,,\n";
          csvContent +=
            "Product Name,Generic Name,Quantity Sold,Quantity Returned,Net Quantity,Revenue,Cost,Profit,Profit Margin %,Return Rate %\n";

          productAnalytics.forEach((product) => {
            csvContent += `"${(product.productName || "").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `"${(product.genericName || "").replace(
              /"/g,
              '""'
            )}",`;
            csvContent += `${product.totalQuantity || 0},`;
            csvContent += `${product.returnedQuantity || 0},`;
            csvContent += `${product.netQuantity || 0},`;
            csvContent += `${product.revenue || 0},`;
            csvContent += `${product.cost || 0},`;
            csvContent += `${product.profit || 0},`;
            csvContent += `${product.profitMargin || 0},`;
            csvContent += `${product.returnRate || 0}\n`;
          });

          // Add batch details for each product
          productAnalytics.forEach((product) => {
            if (product.batchDetails && product.batchDetails.length > 0) {
              csvContent += `\nBatch Details for ${product.productName},,,,,,,,,\n`;
              csvContent +=
                "Batch Number,Purchase Price,Selling Price,Quantity,Returns,Net Quantity,Revenue,Cost,Profit,Profit Margin %\n";

              product.batchDetails.forEach((batch) => {
                csvContent += `"${(batch.batchNumber || batch.batchId || "")
                  .toString()
                  .replace(/"/g, '""')}",`;
                csvContent += `${batch.purchasePrice || 0},`;
                csvContent += `${batch.sellingPrice || 0},`;
                csvContent += `${batch.quantity || 0},`;
                csvContent += `${batch.returnedQuantity || 0},`;
                csvContent += `${batch.netQuantity || 0},`;
                csvContent += `${batch.revenue || 0},`;
                csvContent += `${batch.cost || 0},`;
                csvContent += `${batch.profit || 0},`;
                csvContent += `${batch.profitMargin || 0}\n`;
              });
            }
          });
        }

        // Send CSV to client
        await session.endSession();
        return res.send(csvContent);
      } else if (format === "json") {
        // JSON format response
        await session.endSession();
        return res.status(200).json({
          success: true,
          reportTitle,
          dateRange: {
            from: fromDate,
            to: toDate,
          },
          summary: formattedSummary,
          timePeriods: formattedData,
          productAnalytics,
          paymentMethodAnalytics,
        });
      } else {
        // Unsupported format
        await session.endSession();
        return res.status(400).json({
          success: false,
          message: `${format.toUpperCase()} export format is not supported yet`,
        });
      }
    } catch (error) {
      console.error("Error generating profit report:", error);

      if (session) {
        await session.endSession();
      }

      return res.status(500).json({
        success: false,
        message: "Failed to generate profit report",
        error: error.message,
      });
    }
  }
}

export default SaleController;
