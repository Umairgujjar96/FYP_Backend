import express from "express";
// import { isAuthenticated } from "../middleware/auth.js";

import {
  createMedicineList,
  getMedicineLists,
  getMedicineListById,
  updateMedicineList,
  deleteMedicineList,
  generatePdfMetadata,
} from "../controllers/medicineListController.js";
import {
  addMedicine,
  getMedicines,
  getMedicineById,
  updateMedicine,
  deleteMedicine,
  bulkAddMedicines,
} from "../controllers/medicineController.js";
import { auth } from "../middleware/authMiddleware.js";

const medicalRaprouter = express.Router();

// Medicine List Routes
medicalRaprouter.post("/lists", auth, createMedicineList);
medicalRaprouter.get("/lists/store/:storeId", auth, getMedicineLists);
medicalRaprouter.get("/lists/:listId", auth, getMedicineListById);
medicalRaprouter.put("/lists/:listId", auth, updateMedicineList);
medicalRaprouter.delete("/lists/:listId", auth, deleteMedicineList);
medicalRaprouter.get("/lists/:listId/pdf", auth, generatePdfMetadata);

// Medicine Routes
medicalRaprouter.post("/lists/:listId/medicines", auth, addMedicine);
medicalRaprouter.post("/lists/:listId/medicines/bulk", auth, bulkAddMedicines);
medicalRaprouter.get("/lists/:listId/medicines", auth, getMedicines);
medicalRaprouter.get(
  "/lists/:listId/medicines/:medicineId",
  auth,
  getMedicineById
);
medicalRaprouter.put(
  "/lists/:listId/medicines/:medicineId",
  auth,
  updateMedicine
);
medicalRaprouter.delete(
  "/lists/:listId/medicines/:medicineId",
  auth,
  deleteMedicine
);

export default medicalRaprouter;
