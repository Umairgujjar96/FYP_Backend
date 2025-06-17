import express from "express";
import {
  createProduct,
  getAllProducts,
  getProductDetails,
  updateProduct,
  addProductBatch,
  updateBatch,
  getProductBatches,
  adjustStock,
  getLowStockProducts,
  getExpiringBatches,
  getInventoryValuation,
  deleteProduct,
  restockProduct,
  getInventoryDashboard,
} from "../controllers/productController.js";
import { authorize, protect } from "../middleware/auth.js";
// import { protect, authorize } from "../middleware/auth.js";

const productRouter = express.Router();

// Protect all routes
productRouter.use(protect);

// Product routes

productRouter
  .route("/create")
  .post(authorize("owner", "manager"), createProduct)
  .get(getAllProducts);

productRouter
  .route("/low-stock")
  .get(authorize("owner", "manager", "staff"), getLowStockProducts);

productRouter
  .route("/expiring")
  .get(authorize("owner", "manager", "staff"), getExpiringBatches);

productRouter
  .route("/valuation")
  .get(authorize("owner", "manager"), getInventoryValuation);

productRouter
  .route("/:productId")
  .get(authorize("owner", "manager", "staff"), getProductDetails)
  .put(authorize("owner", "manager"), updateProduct)
  .delete(authorize("owner"), deleteProduct);

// Batch routes
productRouter
  .route("/:productId/batches")
  .post(authorize("owner", "manager"), addProductBatch)
  .get(authorize("owner", "manager", "staff"), getProductBatches);

productRouter
  .route("/batches/:batchId")
  .put(authorize("owner", "manager"), updateBatch);

productRouter
  .route("/batches/:batchId/stock")
  .put(authorize("owner", "manager"), adjustStock);

productRouter.post("/products/:productId/restock", restockProduct);

productRouter.get("/products/inventory", getInventoryDashboard);

export default productRouter;
