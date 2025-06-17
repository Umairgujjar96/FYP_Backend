// import { Medicine } from "../models/medicineModels.js";

import { Medicine, MedicineList } from "../models/medicineSchema.js";

// import { MedicineList } from "../models/medicineModels.js";

// Add a new medicine to a list
export const addMedicine = async (req, res) => {
  try {
    const { listId } = req.params;
    const {
      name,
      company,
      dosage,
      quantity,
      packSize,
      price,
      category,
      expiryDate,
      prescriptionRequired,
      notes,
      isAvailable,
    } = req.body;

    // Check if the medicine list exists and is active
    const medicineList = await MedicineList.findOne({
      _id: listId,
      isActive: true,
    });
    if (!medicineList) {
      return res
        .status(404)
        .json({ message: "Medicine list not found or inactive" });
    }

    const newMedicine = new Medicine({
      medicineList: listId,
      name,
      company,
      dosage,
      quantity,
      packSize,
      price,
      category,
      expiryDate,
      prescriptionRequired,
      notes,
      isAvailable,
    });

    const savedMedicine = await newMedicine.save();
    res.status(201).json(savedMedicine);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all medicines in a list
export const getMedicines = async (req, res) => {
  try {
    const { listId } = req.params;

    // First check if the list exists
    const medicineList = await MedicineList.findById(listId);
    if (!medicineList) {
      return res.status(404).json({ message: "Medicine list not found" });
    }

    const medicines = await Medicine.find({
      medicineList: listId,
      isActive: true,
    }).sort({ name: 1 });

    res.status(200).json(medicines);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a single medicine by ID
export const getMedicineById = async (req, res) => {
  try {
    const { listId, medicineId } = req.params;

    const medicine = await Medicine.findOne({
      _id: medicineId,
      medicineList: listId,
      isActive: true,
    });

    if (!medicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    res.status(200).json(medicine);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a medicine
export const updateMedicine = async (req, res) => {
  try {
    const { listId, medicineId } = req.params;
    const {
      name,
      company,
      dosage,
      quantity,
      packSize,
      price,
      category,
      expiryDate,
      prescriptionRequired,
      notes,
      isAvailable,
    } = req.body;

    const updatedMedicine = await Medicine.findOneAndUpdate(
      {
        _id: medicineId,
        medicineList: listId,
        isActive: true,
      },
      {
        name,
        company,
        dosage,
        quantity,
        packSize,
        price,
        category,
        expiryDate,
        prescriptionRequired,
        notes,
        isAvailable,
      },
      { new: true }
    );

    if (!updatedMedicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    res.status(200).json(updatedMedicine);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete (deactivate) a medicine
export const deleteMedicine = async (req, res) => {
  try {
    const { listId, medicineId } = req.params;

    const medicine = await Medicine.findOneAndUpdate(
      {
        _id: medicineId,
        medicineList: listId,
      },
      { isActive: false },
      { new: true }
    );

    if (!medicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    res.status(200).json({ message: "Medicine deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Bulk add medicines to a list
export const bulkAddMedicines = async (req, res) => {
  try {
    const { listId } = req.params;
    const { medicines } = req.body;

    // Check if the medicine list exists and is active
    const medicineList = await MedicineList.findOne({
      _id: listId,
      isActive: true,
    });
    if (!medicineList) {
      return res
        .status(404)
        .json({ message: "Medicine list not found or inactive" });
    }

    // Prepare medicines for insertion
    const medicinesWithListId = medicines.map((medicine) => ({
      ...medicine,
      medicineList: listId,
    }));

    // Insert multiple medicines
    const savedMedicines = await Medicine.insertMany(medicinesWithListId);

    res.status(201).json(savedMedicines);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
