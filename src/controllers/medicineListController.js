// import { MedicineList } from "../models/medicineModels.js";

import { Medicine, MedicineList } from "../models/medicineSchema.js";

// import { Medicine } from "../models/medicineModels.js";

// Create a new medicine list
export const createMedicineList = async (req, res) => {
  try {
    const { name, description, storeId, notes, priority, targetDate, status } =
      req.body;

    const newMedicineList = new MedicineList({
      store: storeId,
      name,
      description,
      createdBy: req.user._id,
      notes,
      priority,
      targetDate,
      status,
    });

    const savedMedicineList = await newMedicineList.save();
    res.status(201).json(savedMedicineList);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all medicine lists for a store
export const getMedicineLists = async (req, res) => {
  try {
    const { storeId } = req.params;
    const medicineLists = await MedicineList.find({
      store: storeId,
      isActive: true,
    }).sort({ createdAt: -1 });

    res.status(200).json(medicineLists);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a single medicine list by ID
export const getMedicineListById = async (req, res) => {
  try {
    const { listId } = req.params;
    const medicineList = await MedicineList.findById(listId);

    if (!medicineList) {
      return res.status(404).json({ message: "Medicine list not found" });
    }

    // Get all medicines associated with this list
    const medicines = await Medicine.find({
      medicineList: listId,
      isActive: true,
    });

    res.status(200).json({
      medicineList,
      medicines,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a medicine list
export const updateMedicineList = async (req, res) => {
  try {
    const { listId } = req.params;
    const { name, description, notes, priority, targetDate, status } = req.body;

    const updatedMedicineList = await MedicineList.findByIdAndUpdate(
      listId,
      {
        name,
        description,
        notes,
        priority,
        targetDate,
        status,
      },
      { new: true }
    );

    if (!updatedMedicineList) {
      return res.status(404).json({ message: "Medicine list not found" });
    }

    res.status(200).json(updatedMedicineList);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete (deactivate) a medicine list
export const deleteMedicineList = async (req, res) => {
  try {
    const { listId } = req.params;

    const medicineList = await MedicineList.findByIdAndUpdate(
      listId,
      { isActive: false },
      { new: true }
    );

    if (!medicineList) {
      return res.status(404).json({ message: "Medicine list not found" });
    }

    // Also deactivate all medicines in this list
    await Medicine.updateMany({ medicineList: listId }, { isActive: false });

    res.status(200).json({ message: "Medicine list deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Generate PDF for a medicine list (metadata only - actual PDF generation would be on the frontend)
export const generatePdfMetadata = async (req, res) => {
  try {
    const { listId } = req.params;

    const medicineList = await MedicineList.findById(listId)
      .populate(
        "store",
        "name registrationNumber licenseNumber phoneNumber email address"
      )
      .populate("createdBy", "name");

    if (!medicineList) {
      return res.status(404).json({ message: "Medicine list not found" });
    }

    const medicines = await Medicine.find({
      medicineList: listId,
      isActive: true,
    }).sort({ name: 1 });

    // Return the data needed for PDF generation on the client side
    res.status(200).json({
      listDetails: medicineList,
      medicines,
      generatedDate: new Date(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
