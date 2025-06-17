// const { Product, Batch, Category } = require("../models");
// const mongoose = require("mongoose");
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import Category from "../models/Category.js";
import Store from "../models/Store.js";
import Sale from "../models/Sale.js";

const ObjectId = mongoose.Types.ObjectId;

export const createProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      // Product details
      store,
      name,
      genericName,
      description,
      manufacturer,
      requiresPrescription,
      dosageForm,
      strength,
      barcode,
      category,
      minStockLevel,
      image,
      // Batch details
      batchNumber,
      manufacturingDate,
      expiryDate,
      costPrice,
      sellingPrice,
      currentStock,
      supplier,
    } = req.body;

    // Determine store based on user role
    const storeId =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.body.store;

    // Check if product already exists
    let product = await Product.findOne({
      store: storeId,
      name,
      genericName,
      dosageForm,
      strength,
    }).session(session);

    if (!product) {
      product = await Product.create(
        [
          {
            store: storeId,
            name,
            genericName,
            description,
            manufacturer,
            requiresPrescription,
            dosageForm,
            strength,
            barcode,
            category,
            minStockLevel,
            image,
            isActive: true,
          },
        ],
        { session }
      );

      product = product[0];
    }

    // Check if a batch with the same details already exists
    let existingBatch = await Batch.findOne({
      store: storeId,
      product: product._id,
      expiryDate,
      costPrice,
      sellingPrice,
    }).session(session);

    if (existingBatch) {
      // If batch exists, update stock
      existingBatch.currentStock += currentStock;
      await existingBatch.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        success: true,
        message: "Stock updated for existing batch",
        data: {
          product,
          batch: existingBatch,
        },
      });
    }

    // If batch does not exist, create a new batch
    const batch = await Batch.create(
      [
        {
          product: product._id,
          store: storeId,
          batchNumber,
          manufacturingDate,
          expiryDate,
          costPrice,
          sellingPrice,
          currentStock,
          initialStock: currentStock,
          supplier,
          isActive: true,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      data: {
        product,
        batch: batch[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry found. Please check barcode or batch number.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create/update product",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get all products with their current stock from all batches
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */

export const getAllProducts = async (req, res) => {
  try {
    let filter = { isActive: true };

    // Handle store filtering differently based on user role
    if (req.user.role === "owner") {
      // For owners, find all their stores first
      const userStores = await Store.find({ owner: req.user._id }).select(
        "_id"
      );

      if (userStores.length === 0) {
        return res.status(200).json({
          success: true,
          count: 0,
          data: [],
          message: "No stores found for this owner",
        });
      }

      // Use all the owner's store IDs in the filter
      const storeIds = userStores.map((store) => store._id);
      filter.store = { $in: storeIds };
    } else if (req.query.store) {
      // For non-owners (e.g., staff), use the store from query params
      filter.store = new ObjectId(req.query.store);
    } else {
      return res.status(400).json({
        success: false,
        message: "Store ID is required for non-owner users",
      });
    }

    // Apply category filter if provided
    if (req.query.category) {
      filter.category = new ObjectId(req.query.category);
    }

    // Apply search filter if provided
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { name: searchRegex },
        { genericName: searchRegex },
        { description: searchRegex },
      ];
    }

    // Apply prescription filter if provided
    if (req.query.requiresPrescription) {
      filter.requiresPrescription = req.query.requiresPrescription === "true";
    }

    // Pipeline to aggregate products with their batches
    const products = await Product.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "batches",
          localField: "_id",
          foreignField: "product",
          as: "batches",
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $addFields: {
          // Filter out batches with no stock
          batches: {
            $filter: {
              input: "$batches",
              as: "batch",
              cond: { $gt: ["$$batch.currentStock", 0] },
            },
          },
          categoryInfo: { $arrayElemAt: ["$categoryDetails", 0] },
        },
      },
      {
        // Sort batches by expiry date (FEFO - First Expiry, First Out)
        $addFields: {
          // Sort batches by expiry date ascending (oldest first)
          sortedBatches: {
            $sortArray: {
              input: "$batches",
              sortBy: { expiryDate: 1 },
            },
          },
          // Calculate metrics based on available batches
          totalStock: { $sum: "$batches.currentStock" },
          batchesCount: { $size: "$batches" },
          lowestPrice: { $min: "$batches.sellingPrice" },
          highestPrice: { $max: "$batches.sellingPrice" },
          nearestExpiryDate: { $min: "$batches.expiryDate" },
          isLowStock: {
            $lt: [{ $sum: "$batches.currentStock" }, "$minStockLevel"],
          },
          // First batch to be sold (according to FEFO logic)
          nextBatchToSell: {
            $cond: [
              { $gt: [{ $size: "$batches" }, 0] },
              {
                $arrayElemAt: [
                  {
                    $sortArray: {
                      input: "$batches",
                      sortBy: { expiryDate: 1 },
                    },
                  },
                  0,
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $project: {
          name: 1,
          genericName: 1,
          description: 1,
          manufacturer: 1,
          requiresPrescription: 1,
          dosageForm: 1,
          strength: 1,
          barcode: 1,
          minStockLevel: 1,
          image: 1,
          categoryInfo: {
            _id: 1,
            name: 1,
          },
          totalStock: 1,
          batchesCount: 1,
          lowestPrice: 1,
          highestPrice: 1,
          nearestExpiryDate: 1,
          isLowStock: 1,
          createdAt: 1,
          updatedAt: 1,
          // Use sortedBatches to ensure FEFO order
          batches: "$sortedBatches",
          // Include information about the next batch to be sold
          nextBatchToSell: {
            _id: 1,
            batchNumber: 1,
            expiryDate: 1,
            sellingPrice: 1,
            currentStock: 1,
          },
          // Flag to indicate if there are multiple prices across batches
          hasDifferentPrices: {
            $ne: ["$lowestPrice", "$highestPrice"],
          },
          // Default effective price to use based on createSale logic
          defaultEffectivePrice: {
            $cond: [
              { $gt: [{ $size: "$batches" }, 0] },
              {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      {
                        $sortArray: {
                          input: "$batches",
                          sortBy: { expiryDate: 1 },
                        },
                      },
                      0,
                    ],
                  }.sellingPrice,
                  "$sellingPrice",
                ],
              },
              "$sellingPrice",
            ],
          },
        },
      },
      { $sort: { name: 1 } },
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("ERROR in getAllProducts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
    });
  }
};

/**
 * Get a single product with all its batches
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getProductDetails = async (req, res) => {
  try {
    const { productId } = req.params;
    const store =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.query.store;

    const product = await Product.aggregate([
      {
        $match: {
          _id: new ObjectId(productId),
          store: new ObjectId(store),
          isActive: true,
        },
      },
      {
        $lookup: {
          from: "batches",
          localField: "_id",
          foreignField: "product",
          as: "batches",
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $lookup: {
          from: "suppliers",
          localField: "batches.supplier",
          foreignField: "_id",
          as: "supplierDetails",
        },
      },
      {
        $addFields: {
          categoryInfo: { $arrayElemAt: ["$categoryDetails", 0] },
          totalStock: { $sum: "$batches.currentStock" },
          batchesCount: { $size: "$batches" },
          // Add computed fields for analytics
          avgSellingPrice: { $avg: "$batches.sellingPrice" },
          avgCostPrice: { $avg: "$batches.costPrice" },
          avgMargin: {
            $subtract: [
              { $avg: "$batches.sellingPrice" },
              { $avg: "$batches.costPrice" },
            ],
          },
        },
      },
    ]);

    if (!product || product.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Sort batches by expiry date (closest first)
    product[0].batches.sort(
      (a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)
    );

    // Enhance each batch with its supplier details
    product[0].batches = product[0].batches.map((batch) => {
      const supplier = product[0].supplierDetails.find(
        (s) => s._id.toString() === batch.supplier.toString()
      );

      return {
        ...batch,
        supplierInfo: supplier
          ? {
              _id: supplier._id,
              name: supplier.name,
              contactPerson: supplier.contactPerson,
              phoneNumber: supplier.phoneNumber,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      data: product[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch product details",
      error: error.message,
    });
  }
};

/**
 * Update product details
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const store =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.query.store;

    // Fields that can be updated
    const {
      name,
      genericName,
      description,
      manufacturer,
      requiresPrescription,
      dosageForm,
      strength,
      barcode,
      category,
      currentStock,
      minStockLevel,
      image,
    } = req.body;

    const product = await Product.findOneAndUpdate(
      { _id: productId, store },
      {
        name,
        genericName,
        description,
        manufacturer,
        requiresPrescription,
        dosageForm,
        strength,
        barcode,
        category,
        minStockLevel,
        image,
      },
      { new: true, runValidators: true }
    );
    if (currentStock) {
      const setbatch = await Batch.findOne({ product: productId });

      if (setbatch) {
        setbatch.currentStock = currentStock;
        await setbatch.save();
      }
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or you do not have permission to update it",
      });
    }

    res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry found. Please check barcode.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update product",
      error: error.message,
    });
  }
};

/**
 * Add a new batch for an existing product
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const addProductBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const {
      batchNumber,
      manufacturingDate,
      expiryDate,
      costPrice,
      sellingPrice,
      currentStock,
      supplier,
    } = req.body;

    const store = req.user.role === "owner" ? req.user.store : req.body.store;

    // Check if product exists and belongs to the store
    const product = await Product.findOne({
      _id: productId,
      store,
      isActive: true,
    }).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message:
          "Product not found or you do not have permission to add a batch",
      });
    }

    // Check if batch with same batch number already exists for this store
    const existingBatch = await Batch.findOne({
      store,
      batchNumber,
    }).session(session);

    if (existingBatch) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Batch number already exists for this store",
      });
    }

    // Create new batch
    const batch = await Batch.create(
      [
        {
          product: productId,
          store,
          batchNumber,
          manufacturingDate,
          expiryDate,
          costPrice,
          sellingPrice,
          currentStock,
          initialStock: currentStock,
          supplier,
          isActive: true,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      data: batch[0],
    });
  } catch (error) {
    await session.abortTransaction();

    res.status(500).json({
      success: false,
      message: "Failed to add product batch",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Update a product batch
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const updateBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const {
      batchNumber,
      manufacturingDate,
      expiryDate,
      costPrice,
      sellingPrice,
      currentStock,
      supplier,
      isActive,
    } = req.body;

    const store = req.user.role === "owner" ? req.user.store : req.body.store;

    // Check if trying to update batch number and if it already exists
    if (batchNumber) {
      const existingBatch = await Batch.findOne({
        store,
        batchNumber,
        _id: { $ne: batchId },
      });

      if (existingBatch) {
        return res.status(400).json({
          success: false,
          message: "Batch number already exists for this store",
        });
      }
    }

    const batch = await Batch.findOneAndUpdate(
      { _id: batchId, store },
      {
        batchNumber,
        manufacturingDate,
        expiryDate,
        costPrice,
        sellingPrice,
        currentStock,
        supplier,
        isActive,
      },
      { new: true, runValidators: true }
    );

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found or you do not have permission to update it",
      });
    }

    res.status(200).json({
      success: true,
      data: batch,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update batch",
      error: error.message,
    });
  }
};

/**
 * Get all batches for a product
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getProductBatches = async (req, res) => {
  try {
    const { productId } = req.params;
    const store = req.user.role === "owner" ? req.user.store : req.query.store;

    const batches = await Batch.find({
      product: productId,
      store,
    }).populate("supplier", "name contactPerson phoneNumber");

    res.status(200).json({
      success: true,
      count: batches.length,
      data: batches,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch product batches",
      error: error.message,
    });
  }
};

/**
 * Update product stock (adjust quantity)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const adjustStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { batchId } = req.params;
    const { adjustment, reason } = req.body;

    if (!adjustment || isNaN(adjustment)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Please provide a valid stock adjustment value",
      });
    }

    const store = req.user.role === "owner" ? req.user.store : req.body.store;

    // Find the batch
    const batch = await Batch.findOne({
      _id: batchId,
      store,
    }).session(session);

    if (!batch) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message:
          "Batch not found or you do not have permission to adjust its stock",
      });
    }

    // Calculate new stock level
    const newStockLevel = batch.currentStock + adjustment;

    // Prevent negative stock
    if (newStockLevel < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot reduce stock below zero",
      });
    }

    // Update batch with new stock level
    const updatedBatch = await Batch.findByIdAndUpdate(
      batchId,
      { currentStock: newStockLevel },
      { new: true, runValidators: true, session }
    );

    // TODO: Create stock adjustment log here if needed
    // await StockAdjustmentLog.create([{
    //   batch: batchId,
    //   product: batch.product,
    //   store,
    //   previousStock: batch.currentStock,
    //   adjustment,
    //   newStock: newStockLevel,
    //   reason,
    //   adjustedBy: req.user._id
    // }], { session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: updatedBatch,
      message: `Stock ${
        adjustment > 0 ? "increased" : "decreased"
      } by ${Math.abs(adjustment)} units`,
    });
  } catch (error) {
    await session.abortTransaction();

    res.status(500).json({
      success: false,
      message: "Failed to adjust stock",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get low stock products
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getLowStockProducts = async (req, res) => {
  try {
    // Validate user and store data
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    const storeId =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.body.store;

    // Validate the store ID format
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid store ID format",
      });
    }

    const lowStockProducts = await Product.aggregate([
      {
        $match: {
          store: new mongoose.Types.ObjectId(storeId),
          isActive: true,
        },
      },
      {
        $lookup: {
          from: "batches",
          localField: "_id",
          foreignField: "product",
          as: "batches",
        },
      },
      {
        $addFields: {
          totalStock: { $sum: "$batches.currentStock" },
        },
      },
      {
        $match: {
          $expr: { $lt: ["$totalStock", "$minStockLevel"] },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $addFields: {
          categoryInfo: { $arrayElemAt: ["$categoryDetails", 0] },
          stockDeficit: { $subtract: ["$minStockLevel", "$totalStock"] },
        },
      },
      {
        $project: {
          name: 1,
          genericName: 1,
          dosageForm: 1,
          strength: 1,
          minStockLevel: 1,
          totalStock: 1,
          stockDeficit: 1,
          categoryInfo: {
            _id: 1,
            name: 1,
          },
        },
      },
      { $sort: { stockDeficit: -1 } },
    ]);

    // For development only - remove in production

    res.status(200).json({
      success: true,
      count: lowStockProducts.length,
      data: lowStockProducts,
    });
  } catch (error) {
    console.error("Error fetching low stock products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch low stock products",
      error: error.message,
    });
  }
};

/**
 * Get expiring batches
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getExpiringBatches = async (req, res) => {
  try {
    const store =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.query.store;

    // Default to 90 days if not specified
    const daysToExpiry = parseInt(req.query.days) || 90;
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + daysToExpiry);

    const expiringBatches = await Batch.aggregate([
      {
        $match: {
          store: new ObjectId(store),
          isActive: true,
          currentStock: { $gt: 0 },
          expiryDate: { $lte: expiryThreshold },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $addFields: {
          productInfo: { $arrayElemAt: ["$productDetails", 0] },
          daysToExpiry: {
            $divide: [
              { $subtract: ["$expiryDate", new Date()] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $project: {
          batchNumber: 1,
          manufacturingDate: 1,
          expiryDate: 1,
          currentStock: 1,
          sellingPrice: 1,
          daysToExpiry: 1,
          productInfo: {
            _id: 1,
            name: 1,
            genericName: 1,
            dosageForm: 1,
            strength: 1,
          },
        },
      },
      { $sort: { expiryDate: 1 } },
    ]);

    res.status(200).json({
      success: true,
      count: expiringBatches.length,
      data: expiringBatches,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch expiring batches",
      error: error.message,
    });
  }
};

/**
 * Get product inventory valuation
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getInventoryValuation = async (req, res) => {
  try {
    const store =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.query.store;

    const inventoryValuation = await Batch.aggregate([
      {
        $match: {
          store: new ObjectId(store),
          isActive: true,
          currentStock: { $gt: 0 },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $addFields: {
          productInfo: { $arrayElemAt: ["$productDetails", 0] },
          costValue: { $multiply: ["$currentStock", "$costPrice"] },
          sellingValue: { $multiply: ["$currentStock", "$sellingPrice"] },
          potentialProfit: {
            $multiply: [
              "$currentStock",
              { $subtract: ["$sellingPrice", "$costPrice"] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$product",
          productName: { $first: "$productInfo.name" },
          genericName: { $first: "$productInfo.genericName" },
          dosageForm: { $first: "$productInfo.dosageForm" },
          strength: { $first: "$productInfo.strength" },
          totalStock: { $sum: "$currentStock" },
          totalCostValue: { $sum: "$costValue" },
          totalSellingValue: { $sum: "$sellingValue" },
          totalPotentialProfit: { $sum: "$potentialProfit" },
          batches: {
            $push: {
              batchNumber: "$batchNumber",
              expiryDate: "$expiryDate",
              currentStock: "$currentStock",
              costPrice: "$costPrice",
              sellingPrice: "$sellingPrice",
              costValue: "$costValue",
              sellingValue: "$sellingValue",
            },
          },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "productInfo.category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $addFields: {
          categoryInfo: { $arrayElemAt: ["$categoryDetails", 0] },
        },
      },
      {
        $project: {
          _id: 1,
          productName: 1,
          genericName: 1,
          dosageForm: 1,
          strength: 1,
          categoryInfo: {
            _id: 1,
            name: 1,
          },
          totalStock: 1,
          totalCostValue: 1,
          totalSellingValue: 1,
          totalPotentialProfit: 1,
          batches: 1,
        },
      },
      { $sort: { totalCostValue: -1 } },
    ]);

    // Calculate inventory summary
    const summary = inventoryValuation.reduce(
      (acc, product) => {
        acc.totalProducts += 1;
        acc.totalStockUnits += product.totalStock;
        acc.totalCostValue += product.totalCostValue;
        acc.totalSellingValue += product.totalSellingValue;
        acc.totalPotentialProfit += product.totalPotentialProfit;
        return acc;
      },
      {
        totalProducts: 0,
        totalStockUnits: 0,
        totalCostValue: 0,
        totalSellingValue: 0,
        totalPotentialProfit: 0,
      }
    );

    res.status(200).json({
      success: true,
      count: inventoryValuation.length,
      summary,
      data: inventoryValuation,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch inventory valuation",
      error: error.message,
    });
  }
};

/**
 * Soft delete a product (mark as inactive)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const deleteProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const store =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.query.store;

    // Check if product has any sales
    // TODO: Implement check for existing sales
    // const hasSales = await Sale.findOne({
    //   'items.product': productId
    // });

    // if (hasSales) {
    //   await session.abortTransaction();
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Cannot delete product with existing sales. You can mark it as inactive instead.'
    //   });
    // }

    // Soft delete product (mark as inactive)
    const product = await Product.findOneAndUpdate(
      { _id: productId, store },
      { isActive: false },
      { new: true, session }
    );

    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Product not found or you do not have permission to delete it",
      });
    }

    // Mark all batches as inactive
    await Batch.updateMany(
      { product: productId, store },
      { isActive: false },
      { session }
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Product successfully marked as inactive",
      data: product,
    });
  } catch (error) {
    await session.abortTransaction();

    res.status(500).json({
      success: false,
      message: "Failed to delete product",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export const restockProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const {
      batchNumber,
      manufacturingDate,
      expiryDate,
      costPrice,
      sellingPrice,
      quantity,
      supplier,
      reason,
    } = req.body;

    // Determine store based on user role
    const storeId =
      req.user.role === "owner"
        ? await Store.findOne({ owner: req.user._id }).select("_id")
        : req.body.store;

    if (!productId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    if (!quantity || quantity <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Valid quantity is required for restocking",
      });
    }

    // Check if product exists and belongs to the store
    const product = await Product.findOne({
      _id: productId,
      store: storeId,
      isActive: true,
    }).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message:
          "Product not found or you do not have permission to restock it",
      });
    }

    // Validate required fields for creating a new batch
    if (
      !batchNumber ||
      !expiryDate ||
      !costPrice ||
      !sellingPrice ||
      !supplier
    ) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "All batch details (batchNumber, expiryDate, costPrice, sellingPrice, supplier) are required for restocking",
      });
    }

    // Check if a batch with the same batch number already exists
    const existingBatch = await Batch.findOne({
      store: storeId,
      batchNumber,
      isActive: true,
    }).session(session);

    if (existingBatch) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "A batch with this batch number already exists. Please use a unique batch number.",
      });
    }

    // Always create a new batch
    const newBatch = await Batch.create(
      [
        {
          product: productId,
          store: storeId,
          batchNumber,
          manufacturingDate,
          expiryDate,
          costPrice,
          sellingPrice,
          currentStock: quantity,
          initialStock: quantity,
          supplier,
          isActive: true,
        },
      ],
      { session }
    );

    const message = `Created new batch ${batchNumber} with ${quantity} units.`;

    // TODO: Create restock log entry if needed
    // await RestockLog.create([{
    //   batch: newBatch[0]._id,
    //   product: productId,
    //   store: storeId,
    //   quantity,
    //   reason,
    //   restockedBy: req.user._id,
    //   costPrice: newBatch[0].costPrice,
    //   timestamp: new Date()
    // }], { session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message,
      data: {
        product,
        batch: newBatch[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry found. Please check batch number.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to restock product",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get inventory dashboard statistics
 * Consolidates data for total products, batches, stock levels, expiring products, and financial valuation
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const getInventoryDashboard = async (req, res) => {
  try {
    // Use mongoose from import instead of require
    // Import this at the top of your file instead:
    // import { Types } from 'mongoose';
    // const { ObjectId } = Types;

    // Determine store based on user role
    let storeId;
    if (req.user.role === "owner") {
      const store = await Store.findOne({ owner: req.user._id }).select("_id");
      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found for this owner",
        });
      }
      storeId = store._id;
    } else {
      storeId = req.query.store;
    }

    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    // Set expiry threshold (90 days from now by default)
    const daysToExpiry = parseInt(req.query.expiryDays) || 90;
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + daysToExpiry);

    // Set date range for sales statistics
    const timeRange = req.query.timeRange || "month"; // Default to month
    const salesEndDate = new Date();
    const salesStartDate = new Date();

    // Configure time range based on request
    switch (timeRange) {
      case "week":
        salesStartDate.setDate(salesStartDate.getDate() - 7);
        break;
      case "month":
        salesStartDate.setMonth(salesStartDate.getMonth() - 1);
        break;
      case "quarter":
        salesStartDate.setMonth(salesStartDate.getMonth() - 3);
        break;
      case "year":
        salesStartDate.setFullYear(salesStartDate.getFullYear() - 1);
        break;
      default:
        salesStartDate.setMonth(salesStartDate.getMonth() - 1);
    }

    // SECTION 1: Summary statistics
    const productCount = await Product.countDocuments({
      store: storeId,
      isActive: true,
    });

    const batchCount = await Batch.countDocuments({
      store: storeId,
      isActive: true,
    });

    // Get inventory valuation summary
    const valuationData = await Batch.aggregate([
      {
        $match: {
          store: storeId,
          isActive: true,
        },
      },
      {
        $group: {
          _id: null,
          totalStockUnits: { $sum: { $ifNull: ["$currentStock", 0] } },
          totalCostValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$currentStock", 0] },
                { $ifNull: ["$costPrice", 0] },
              ],
            },
          },
          totalSellingValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$currentStock", 0] },
                { $ifNull: ["$sellingPrice", 0] },
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalStockUnits: 1,
          totalCostValue: 1,
          totalSellingValue: 1,
          totalPotentialProfit: {
            $subtract: ["$totalSellingValue", "$totalCostValue"],
          },
        },
      },
    ]);

    // SECTION 2: Low stock products
    const lowStockProducts = await Product.aggregate([
      {
        $match: {
          store: storeId,
          isActive: true,
        },
      },
      {
        $lookup: {
          from: "batches",
          localField: "_id",
          foreignField: "product",
          as: "batches",
        },
      },
      {
        $addFields: {
          totalStock: {
            $sum: {
              $map: {
                input: "$batches",
                as: "batch",
                in: { $ifNull: ["$$batch.currentStock", 0] },
              },
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gt: [{ $ifNull: ["$minStockLevel", 0] }, 0] },
              { $lt: ["$totalStock", { $ifNull: ["$minStockLevel", 0] }] },
            ],
          },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $addFields: {
          categoryName: {
            $cond: {
              if: { $gt: [{ $size: "$categoryDetails" }, 0] },
              then: { $arrayElemAt: ["$categoryDetails.name", 0] },
              else: "Uncategorized",
            },
          },
          stockDeficit: {
            $subtract: [
              { $ifNull: ["$minStockLevel", 0] },
              { $ifNull: ["$totalStock", 0] },
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          genericName: 1,
          dosageForm: 1,
          strength: 1,
          totalStock: 1,
          minStockLevel: 1,
          stockDeficit: 1,
          categoryName: 1,
        },
      },
      {
        $sort: { stockDeficit: -1 },
      },
      {
        $limit: 10, // Top 10 low stock items
      },
    ]);

    // SECTION 3: Expiring soon products
    const expiringBatches = await Batch.aggregate([
      {
        $match: {
          store: storeId,
          isActive: true,
          currentStock: { $gt: 0 },
          expiryDate: { $exists: true, $ne: null, $lte: expiryThreshold },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $addFields: {
          productName: {
            $cond: {
              if: { $gt: [{ $size: "$productDetails" }, 0] },
              then: { $arrayElemAt: ["$productDetails.name", 0] },
              else: "Unknown Product",
            },
          },
          genericName: { $arrayElemAt: ["$productDetails.genericName", 0] },
          dosageForm: { $arrayElemAt: ["$productDetails.dosageForm", 0] },
          strength: { $arrayElemAt: ["$productDetails.strength", 0] },
          daysToExpiry: {
            $ceil: {
              $divide: [
                { $subtract: ["$expiryDate", new Date()] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          productId: {
            $cond: {
              if: { $gt: [{ $size: "$productDetails" }, 0] },
              then: { $arrayElemAt: ["$productDetails._id", 0] },
              else: null,
            },
          },
          productName: 1,
          genericName: 1,
          dosageForm: 1,
          strength: 1,
          batchNumber: 1,
          expiryDate: 1,
          daysToExpiry: 1,
          currentStock: 1,
          sellingPrice: 1,
          potentialLoss: {
            $multiply: [
              { $ifNull: ["$currentStock", 0] },
              { $ifNull: ["$costPrice", 0] },
            ],
          },
        },
      },
      {
        $sort: { daysToExpiry: 1 },
      },
      {
        $limit: 10, // Top 10 soon-to-expire items
      },
    ]);

    // SECTION 4: Inventory by category
    const categoryBreakdown = await Product.aggregate([
      {
        $match: {
          store: storeId,
          isActive: true,
        },
      },
      {
        $lookup: {
          from: "batches",
          localField: "_id",
          foreignField: "product",
          as: "batches",
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $addFields: {
          categoryName: {
            $cond: {
              if: { $gt: [{ $size: "$categoryDetails" }, 0] },
              then: { $arrayElemAt: ["$categoryDetails.name", 0] },
              else: "Uncategorized",
            },
          },
          categoryId: {
            $cond: {
              if: { $gt: [{ $size: "$categoryDetails" }, 0] },
              then: { $arrayElemAt: ["$categoryDetails._id", 0] },
              else: null,
            },
          },
          totalStock: {
            $sum: {
              $map: {
                input: "$batches",
                as: "batch",
                in: { $ifNull: ["$$batch.currentStock", 0] },
              },
            },
          },
          stockValue: {
            $sum: {
              $map: {
                input: "$batches",
                as: "batch",
                in: {
                  $multiply: [
                    { $ifNull: ["$$batch.currentStock", 0] },
                    { $ifNull: ["$$batch.costPrice", 0] },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: "$categoryId",
          categoryName: { $first: "$categoryName" },
          productCount: { $sum: 1 },
          totalStock: { $sum: "$totalStock" },
          totalValue: { $sum: "$stockValue" },
        },
      },
      {
        $sort: { totalValue: -1 },
      },
    ]);

    // SECTION 5: Fast moving products (high sales velocity)
    const stockMovement = await Batch.aggregate([
      {
        $match: {
          store: storeId,
          isActive: true,
          initialStock: { $gt: 0 },
        },
      },
      {
        $addFields: {
          soldQuantity: {
            $subtract: [
              { $ifNull: ["$initialStock", 0] },
              { $ifNull: ["$currentStock", 0] },
            ],
          },
          soldPercentage: {
            $multiply: [
              {
                $cond: {
                  if: { $gt: [{ $ifNull: ["$initialStock", 0] }, 0] },
                  then: {
                    $divide: [
                      {
                        $subtract: [
                          { $ifNull: ["$initialStock", 0] },
                          { $ifNull: ["$currentStock", 0] },
                        ],
                      },
                      { $ifNull: ["$initialStock", 1] }, // Avoid division by zero
                    ],
                  },
                  else: 0,
                },
              },
              100,
            ],
          },
        },
      },
      {
        $match: {
          soldQuantity: { $gt: 0 },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $addFields: {
          productName: {
            $cond: {
              if: { $gt: [{ $size: "$productDetails" }, 0] },
              then: { $arrayElemAt: ["$productDetails.name", 0] },
              else: "Unknown Product",
            },
          },
          genericName: { $arrayElemAt: ["$productDetails.genericName", 0] },
        },
      },
      {
        $group: {
          _id: "$product",
          productName: { $first: "$productName" },
          genericName: { $first: "$genericName" },
          totalSold: { $sum: "$soldQuantity" },
          totalInitial: { $sum: "$initialStock" },
          averageSoldPercentage: { $avg: "$soldPercentage" },
        },
      },
      {
        $sort: { totalSold: -1 },
      },
      {
        $limit: 5,
      },
    ]);

    // SECTION 6: Recently added products
    const recentProducts = await Product.find({
      store: storeId,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("category", "name")
      .lean();

    // SECTION 7: Sales performance metrics (NEW)
    const salesMetrics = await Sale.aggregate([
      {
        $match: {
          store: storeId,
          createdAt: { $gte: salesStartDate, $lte: salesEndDate },
        },
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: "$total" },
          totalReturnAmount: { $sum: "$returnTotal" },
          netSales: { $sum: "$finalTotal" },
          salesCount: { $sum: 1 },
          averageSaleValue: { $avg: "$total" },
        },
      },
    ]);

    // SECTION 8: Product-wise sales analysis (NEW)
    // SECTION 8: Product-wise sales analysis (FIXED)
    const productSalesAnalysis = await Sale.aggregate([
      {
        $match: {
          store: storeId,
          createdAt: { $gte: salesStartDate, $lte: salesEndDate },
        },
      },
      {
        $unwind: "$items",
      },
      {
        $group: {
          _id: "$items.product",
          totalQuantitySold: { $sum: "$items.quantity" },
          totalQuantityReturned: { $sum: "$items.returnedQuantity" },
          netQuantitySold: {
            $sum: {
              $subtract: ["$items.quantity", "$items.returnedQuantity"],
            },
          },
          totalRevenue: {
            $sum: {
              $multiply: [
                { $subtract: ["$items.quantity", "$items.returnedQuantity"] },
                "$items.unitPrice",
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $addFields: {
          productName: { $arrayElemAt: ["$productDetails.name", 0] },
          genericName: { $arrayElemAt: ["$productDetails.genericName", 0] },
        },
      },
      {
        $project: {
          _id: 1,
          productName: 1,
          genericName: 1,
          totalQuantitySold: 1,
          totalQuantityReturned: 1,
          netQuantitySold: 1,
          totalRevenue: 1,
          // Removed the exclusion of productDetails
        },
      },
      {
        $sort: { totalRevenue: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    // SECTION 9: Stock turnover rate analysis (NEW)
    const stockTurnoverAnalysis = await Batch.aggregate([
      {
        $match: {
          store: storeId,
          isActive: true,
          initialStock: { $gt: 0 },
        },
      },
      {
        $addFields: {
          soldStock: {
            $subtract: ["$initialStock", "$currentStock"],
          },
          turnoverRate: {
            $cond: {
              if: { $gt: ["$initialStock", 0] },
              then: {
                $divide: [
                  { $subtract: ["$initialStock", "$currentStock"] },
                  "$initialStock",
                ],
              },
              else: 0,
            },
          },
          daysSincePurchase: {
            $divide: [
              { $subtract: [new Date(), "$createdAt"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "productDetails.category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      {
        $addFields: {
          productName: { $arrayElemAt: ["$productDetails.name", 0] },
          categoryName: {
            $cond: {
              if: { $gt: [{ $size: "$categoryDetails" }, 0] },
              then: { $arrayElemAt: ["$categoryDetails.name", 0] },
              else: "Uncategorized",
            },
          },
          // Calculate daily turnover rate
          dailyTurnoverRate: {
            $cond: {
              if: { $gt: ["$daysSincePurchase", 0] },
              then: {
                $divide: ["$turnoverRate", "$daysSincePurchase"],
              },
              else: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: "$productName",
          categoryName: { $first: "$categoryName" },
          avgTurnoverRate: { $avg: "$turnoverRate" },
          avgDailyTurnoverRate: { $avg: "$dailyTurnoverRate" },
          totalSoldStock: { $sum: "$soldStock" },
          totalInitialStock: { $sum: "$initialStock" },
        },
      },
      {
        $project: {
          _id: 0,
          productName: "$_id",
          categoryName: 1,
          avgTurnoverRate: 1,
          avgDailyTurnoverRate: 1,
          totalSoldStock: 1,
          totalInitialStock: 1,
        },
      },
      {
        $sort: { avgDailyTurnoverRate: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    // SECTION 10: Supplier performance analysis (NEW)
    const supplierPerformance = await Batch.aggregate([
      {
        $match: {
          store: storeId,
          supplier: { $exists: true, $ne: null },
        },
      },
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier",
          foreignField: "_id",
          as: "supplierDetails",
        },
      },
      {
        $addFields: {
          supplierName: { $arrayElemAt: ["$supplierDetails.name", 0] },
        },
      },
      {
        $group: {
          _id: "$supplier",
          supplierName: { $first: "$supplierName" },
          batchCount: { $sum: 1 },
          totalStockProvided: { $sum: "$initialStock" },
          totalStockValue: {
            $sum: { $multiply: ["$initialStock", "$costPrice"] },
          },
          averageCostPrice: { $avg: "$costPrice" },
        },
      },
      {
        $project: {
          _id: 1,
          supplierName: 1,
          batchCount: 1,
          totalStockProvided: 1,
          totalStockValue: 1,
          averageCostPrice: 1,
        },
      },
      {
        $sort: { totalStockValue: -1 },
      },
      {
        $limit: 5,
      },
    ]);

    // Compose final response object
    const dashboardData = {
      summary: {
        totalProducts: productCount,
        totalBatches: batchCount,
        ...((valuationData && valuationData[0]) || {
          totalStockUnits: 0,
          totalCostValue: 0,
          totalSellingValue: 0,
          totalPotentialProfit: 0,
        }),
        ...(salesMetrics && salesMetrics[0]
          ? {
              periodSales: salesMetrics[0].totalSales || 0,
              periodReturns: salesMetrics[0].totalReturnAmount || 0,
              periodNetSales: salesMetrics[0].netSales || 0,
              periodSalesCount: salesMetrics[0].salesCount || 0,
              periodAvgSaleValue: salesMetrics[0].averageSaleValue || 0,
            }
          : {
              periodSales: 0,
              periodReturns: 0,
              periodNetSales: 0,
              periodSalesCount: 0,
              periodAvgSaleValue: 0,
            }),
        timeRange: timeRange,
      },
      lowStock: lowStockProducts,
      expiring: expiringBatches,
      categoryBreakdown: categoryBreakdown,
      stockMovement: stockMovement,
      recentProducts: recentProducts.map((p) => ({
        _id: p._id,
        name: p.name,
        genericName: p.genericName,
        categoryName: p.category ? p.category.name : "Uncategorized",
        createdAt: p.createdAt,
      })),
      // New sections
      topSellingProducts: productSalesAnalysis || [],
      stockTurnover: stockTurnoverAnalysis || [],
      supplierPerformance: supplierPerformance || [],
    };

    return res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error("Error in getInventoryDashboard:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch inventory dashboard data",
      error: error.message,
    });
  }
};
// import mongoose from "mongoose";
// import Product from "../models/Product.js";
// import Category from "../models/Category.js";
// import Store from "../models/Store.js";
// import Batch from "../models/Batch.js";
// const ObjectId = mongoose.Types.ObjectId;

// // Get all products (with pagination and filtering)
// export const getAllProducts = async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 10,
//       storeId,
//       category,
//       name,
//       requiresPrescription,
//       isActive = true,
//     } = req.query;

//     const query = { isActive };

//     // Apply filters if provided
//     if (storeId) query.store = new ObjectId(storeId);
//     if (category) query.category = new ObjectId(category);
//     if (name) query.name = { $regex: name, $options: "i" };
//     if (requiresPrescription !== undefined) {
//       query.requiresPrescription = requiresPrescription === "true";
//     }

//     // Validate store exists if storeId is provided
//     if (storeId) {
//       const storeExists = await Store.exists({ _id: storeId, isActive: true });
//       if (!storeExists) {
//         return res
//           .status(404)
//           .json({ success: false, message: "Store not found" });
//       }
//     }

//     const options = {
//       page: parseInt(page),
//       limit: parseInt(limit),
//       sort: { updatedAt: -1 },
//       populate: [
//         { path: "category", select: "name" },
//         { path: "store", select: "name" },
//       ],
//     };

//     const products = await Product.paginate(query, options);

//     return res.status(200).json({
//       success: true,
//       data: products.docs,
//       pagination: {
//         total: products.totalDocs,
//         pages: products.totalPages,
//         page: products.page,
//         limit: products.limit,
//         hasNext: products.hasNextPage,
//         hasPrev: products.hasPrevPage,
//       },
//     });
//   } catch (error) {
//     console.error("Error getting products:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to retrieve products",
//       error: error.message,
//     });
//   }
// };

// // Get product by ID
// export const getProductById = async (req, res) => {
//   try {
//     const { productId } = req.params;

//     if (!mongoose.isValidObjectId(productId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid product ID format" });
//     }

//     const product = await Product.findOne({ _id: productId, isActive: true })
//       .populate("category", "name description")
//       .populate("store", "name");

//     if (!product) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });
//     }

//     return res.status(200).json({ success: true, data: product });
//   } catch (error) {
//     console.error("Error getting product:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to retrieve product",
//       error: error.message,
//     });
//   }
// };
// // Create new product with automatic batch creation
// export const createProduct = async (req, res) => {
//   try {
//     const {
//       storeId,
//       categoryId,
//       name,
//       genericName,
//       description,
//       manufacturer,
//       requiresPrescription,
//       dosageForm,
//       strength,
//       barcode,
//       image,
//       minStockLevel,
//       costPrice,
//       sellingPrice,
//       initialStock,
//       manufacturingDate,
//       expiryDate,
//       supplierId,
//     } = req.body;

//     // Validate required fields
//     if (!storeId || !name || !costPrice || !sellingPrice || !initialStock) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Store ID, product name, cost price, selling price, and initial stock are required",
//       });
//     }

//     // Validate store exists
//     const storeExists = await Store.exists({ _id: storeId, isActive: true });
//     if (!storeExists) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Store not found" });
//     }

//     // Validate category if provided
//     if (categoryId) {
//       const categoryExists = await Category.exists({
//         _id: categoryId,
//         store: storeId,
//         isActive: true,
//       });
//       if (!categoryExists) {
//         return res.status(404).json({
//           success: false,
//           message:
//             "Category not found or does not belong to the specified store",
//         });
//       }
//     }

//     // Check for duplicate barcode if provided
//     if (barcode) {
//       const existingBarcode = await Product.findOne({
//         barcode,
//         isActive: true,
//       });
//       if (existingBarcode) {
//         return res.status(409).json({
//           success: false,
//           message: "Product with this barcode already exists",
//         });
//       }
//     }

//     // Create new product
//     const newProduct = new Product({
//       store: storeId,
//       category: categoryId,
//       name,
//       genericName,
//       description,
//       manufacturer,
//       requiresPrescription: requiresPrescription || false,
//       dosageForm,
//       strength,
//       barcode,
//       image,
//       minStockLevel: minStockLevel || 10,
//       isActive: true,
//     });

//     await newProduct.save();

//     // Check if a batch with the same name, cost price, selling price, and strength already exists
//     const existingBatch = await Batch.findOne({
//       store: storeId,
//       product: newProduct._id,
//       costPrice,
//       sellingPrice,
//       strength,
//     });

//     let batch;
//     if (!existingBatch) {
//       // Create a new batch
//       batch = new Batch({
//         product: newProduct._id,
//         store: storeId,
//         batchNumber: `BATCH-${Date.now()}`, // Generate a unique batch number
//         manufacturingDate: manufacturingDate || new Date(),
//         expiryDate,
//         costPrice,
//         sellingPrice,
//         currentStock: initialStock,
//         initialStock,
//         supplier: supplierId || null,
//         isActive: true,
//       });

//       await batch.save();
//     }

//     return res.status(201).json({
//       success: true,
//       message: "Product created successfully",
//       data: {
//         product: newProduct,
//         batch: batch ? batch : "No new batch created (existing batch found).",
//       },
//     });
//   } catch (error) {
//     console.error("Error creating product and batch:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to create product and batch",
//       error: error.message,
//     });
//   }
// };

// // Update product
// export const updateProduct = async (req, res) => {
//   try {
//     const { productId } = req.params;
//     const updateData = req.body;

//     if (!mongoose.isValidObjectId(productId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid product ID format" });
//     }

//     // Find product to ensure it exists
//     const product = await Product.findOne({ _id: productId, isActive: true });
//     if (!product) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });
//     }

//     // Check if trying to update store (which we might want to prevent)
//     if (
//       updateData.storeId &&
//       updateData.storeId.toString() !== product.store.toString()
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot change product store assignment",
//       });
//     }

//     // Validate category if updating
//     if (updateData.categoryId) {
//       const categoryExists = await Category.exists({
//         _id: updateData.categoryId,
//         store: product.store,
//         isActive: true,
//       });

//       if (!categoryExists) {
//         return res.status(404).json({
//           success: false,
//           message: "Category not found or does not belong to this store",
//         });
//       }

//       // Map categoryId to category for MongoDB schema
//       updateData.category = updateData.categoryId;
//       delete updateData.categoryId;
//     }

//     // Check for duplicate barcode if updating
//     if (updateData.barcode && updateData.barcode !== product.barcode) {
//       const existingBarcode = await Product.findOne({
//         barcode: updateData.barcode,
//         _id: { $ne: productId },
//         isActive: true,
//       });

//       if (existingBarcode) {
//         return res.status(409).json({
//           success: false,
//           message: "Product with this barcode already exists",
//         });
//       }
//     }

//     // Remove storeId from updateData and map to schema fields
//     if (updateData.storeId) {
//       delete updateData.storeId;
//     }

//     const updatedProduct = await Product.findByIdAndUpdate(
//       productId,
//       updateData,
//       { new: true, runValidators: true }
//     ).populate("category", "name");

//     return res.status(200).json({
//       success: true,
//       message: "Product updated successfully",
//       data: updatedProduct,
//     });
//   } catch (error) {
//     console.error("Error updating product:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to update product",
//       error: error.message,
//     });
//   }
// };

// // Delete product (soft delete)
// export const deleteProduct = async (req, res) => {
//   try {
//     const { productId } = req.params;

//     if (!mongoose.isValidObjectId(productId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid product ID format" });
//     }

//     const product = await Product.findById(productId);
//     if (!product) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });
//     }

//     // Instead of deleting, mark as inactive
//     product.isActive = false;
//     await product.save();

//     return res.status(200).json({
//       success: true,
//       message: "Product deleted successfully",
//     });
//   } catch (error) {
//     console.error("Error deleting product:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to delete product",
//       error: error.message,
//     });
//   }
// };

// // Get products by category
// export const getProductsByCategory = async (req, res) => {
//   try {
//     const { categoryId } = req.params;
//     const { page = 1, limit = 10 } = req.query;

//     if (!mongoose.isValidObjectId(categoryId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid category ID format" });
//     }

//     // Validate category exists
//     const categoryExists = await Category.exists({
//       _id: categoryId,
//       isActive: true,
//     });
//     if (!categoryExists) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Category not found" });
//     }

//     const options = {
//       page: parseInt(page),
//       limit: parseInt(limit),
//       sort: { name: 1 },
//       populate: "store",
//     };

//     const products = await Product.paginate(
//       { category: categoryId, isActive: true },
//       options
//     );

//     return res.status(200).json({
//       success: true,
//       data: products.docs,
//       pagination: {
//         total: products.totalDocs,
//         pages: products.totalPages,
//         page: products.page,
//         limit: products.limit,
//         hasNext: products.hasNextPage,
//         hasPrev: products.hasPrevPage,
//       },
//     });
//   } catch (error) {
//     console.error("Error getting products by category:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to retrieve products",
//       error: error.message,
//     });
//   }
// };

// // Get products by store
// export const getProductsByStore = async (req, res) => {
//   try {
//     const { storeId } = req.params;
//     const {
//       page = 1,
//       limit = 10,
//       name,
//       categoryId,
//       requiresPrescription,
//     } = req.query;

//     if (!mongoose.isValidObjectId(storeId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid store ID format" });
//     }

//     // Validate store exists
//     const storeExists = await Store.exists({ _id: storeId, isActive: true });
//     if (!storeExists) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Store not found" });
//     }

//     // Build query
//     const query = { store: storeId, isActive: true };

//     if (name) query.name = { $regex: name, $options: "i" };
//     if (categoryId) query.category = new ObjectId(categoryId);
//     if (requiresPrescription !== undefined) {
//       query.requiresPrescription = requiresPrescription === "true";
//     }

//     const options = {
//       page: parseInt(page),
//       limit: parseInt(limit),
//       sort: { name: 1 },
//       populate: { path: "category", select: "name" },
//     };

//     const products = await Product.paginate(query, options);

//     return res.status(200).json({
//       success: true,
//       data: products.docs,
//       pagination: {
//         total: products.totalDocs,
//         pages: products.totalPages,
//         page: products.page,
//         limit: products.limit,
//         hasNext: products.hasNextPage,
//         hasPrev: products.hasPrevPage,
//       },
//     });
//   } catch (error) {
//     console.error("Error getting store products:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to retrieve store products",
//       error: error.message,
//     });
//   }
// };

// // Search products
// export const searchProducts = async (req, res) => {
//   try {
//     const { query: searchQuery, storeId, page = 1, limit = 10 } = req.query;

//     if (!searchQuery) {
//       return res.status(400).json({
//         success: false,
//         message: "Search query is required",
//       });
//     }

//     const query = {
//       isActive: true,
//       $or: [
//         { name: { $regex: searchQuery, $options: "i" } },
//         { genericName: { $regex: searchQuery, $options: "i" } },
//         { description: { $regex: searchQuery, $options: "i" } },
//         { barcode: { $regex: searchQuery, $options: "i" } },
//       ],
//     };

//     // Filter by store if provided
//     if (storeId) {
//       if (!mongoose.isValidObjectId(storeId)) {
//         return res
//           .status(400)
//           .json({ success: false, message: "Invalid store ID format" });
//       }
//       query.store = new ObjectId(storeId);
//     }

//     const options = {
//       page: parseInt(page),
//       limit: parseInt(limit),
//       sort: { name: 1 },
//       populate: [
//         { path: "category", select: "name" },
//         { path: "store", select: "name" },
//       ],
//     };

//     const products = await Product.paginate(query, options);

//     return res.status(200).json({
//       success: true,
//       data: products.docs,
//       pagination: {
//         total: products.totalDocs,
//         pages: products.totalPages,
//         page: products.page,
//         limit: products.limit,
//         hasNext: products.hasNextPage,
//         hasPrev: products.hasPrevPage,
//       },
//     });
//   } catch (error) {
//     console.error("Error searching products:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to search products",
//       error: error.message,
//     });
//   }
// };
