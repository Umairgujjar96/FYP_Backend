import fs from "fs";
import path from "path";

const setupUploads = () => {
  const uploadDir = path.join(process.cwd(), "uploads");
  const prescriptionsDir = path.join(uploadDir, "prescriptions");

  // Create directories if they don't exist
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    if (!fs.existsSync(prescriptionsDir)) {
      fs.mkdirSync(prescriptionsDir);
    }
  } catch (error) {
    console.error("Error creating upload directories:", error);
    throw error;
  }
};

export default setupUploads;
