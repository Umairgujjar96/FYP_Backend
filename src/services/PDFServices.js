import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * Generate a PDF for a medicine list
 * @param {Object} medicineList - The medicine list with populated fields
 * @returns {Promise<string>} - Path to the generated PDF file
 */
export const generateMedicineListPDF = (medicineList) => {
  return new Promise((resolve, reject) => {
    try {
      // Create a document
      const doc = new PDFDocument({ margin: 50 });

      // Generate a unique filename
      const filename = `medicine_list_${medicineList._id}_${uuidv4()}.pdf`;
      const outputPath = path.join(
        __dirname,
        "..",
        "uploads",
        "pdfs",
        filename
      );

      // Ensure the directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Pipe the PDF document to a write stream
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Add store logo if available (placeholder)
      // doc.image('path/to/logo.png', 50, 45, { width: 50 });

      // Set font
      doc.font("Helvetica-Bold");

      // Add title
      doc.fontSize(20).text("Medicine Order List", { align: "center" });
      doc.moveDown();

      // Add store and supplier information
      doc.fontSize(12);
      doc.font("Helvetica-Bold").text("Store:", { continued: true });
      doc.font("Helvetica").text(` ${medicineList.store.name}`);

      if (medicineList.store.address) {
        const address = medicineList.store.address;
        const addressStr = [
          address.street,
          address.city,
          address.state,
          address.zipCode,
          address.country,
        ]
          .filter(Boolean)
          .join(", ");

        doc.font("Helvetica").text(`${addressStr}`);
      }

      doc.moveDown();

      // Add supplier info if available
      if (medicineList.supplier) {
        doc.font("Helvetica-Bold").text("Supplier:", { continued: true });
        doc.font("Helvetica").text(` ${medicineList.supplier.name}`);

        if (medicineList.supplier.contactPerson) {
          doc
            .font("Helvetica")
            .text(`Contact: ${medicineList.supplier.contactPerson}`);
        }

        if (medicineList.supplier.phoneNumber) {
          doc
            .font("Helvetica")
            .text(`Phone: ${medicineList.supplier.phoneNumber}`);
        }

        if (medicineList.supplier.address) {
          const address = medicineList.supplier.address;
          const addressStr = [
            address.street,
            address.city,
            address.state,
            address.zipCode,
            address.country,
          ]
            .filter(Boolean)
            .join(", ");

          doc.font("Helvetica").text(`Address: ${addressStr}`);
        }
      }

      doc.moveDown();

      // Add list details
      doc.font("Helvetica-Bold").text("List Details");
      doc.font("Helvetica").text(`Title: ${medicineList.title}`);
      if (medicineList.description) {
        doc.font("Helvetica").text(`Description: ${medicineList.description}`);
      }
      doc
        .font("Helvetica")
        .text(
          `Created by: ${medicineList.createdBy.firstName} ${medicineList.createdBy.lastName}`
        );
      doc
        .font("Helvetica")
        .text(`Date: ${new Date(medicineList.createdAt).toLocaleDateString()}`);

      doc.moveDown();

      // Add medicines table header
      doc.font("Helvetica-Bold");
      const startX = 50;
      let y = doc.y;

      // Draw table header
      doc.text("No.", startX, y);
      doc.text("Medicine Name", startX + 40, y);
      doc.text("Manufacturer", startX + 180, y);
      doc.text("Form", startX + 300, y);
      doc.text("Quantity", startX + 360, y);
      doc.text("Notes", startX + 420, y);

      y += 20;
      doc.moveTo(50, y).lineTo(550, y).stroke();
      y += 10;

      // Add medicines
      doc.font("Helvetica");
      medicineList.medicines.forEach((item, index) => {
        // Check if we need a new page
        if (y > 700) {
          doc.addPage();
          y = 50;

          // Redraw header on new page
          doc.font("Helvetica-Bold");
          doc.text("No.", startX, y);
          doc.text("Medicine Name", startX + 40, y);
          doc.text("Manufacturer", startX + 180, y);
          doc.text("Form", startX + 300, y);
          doc.text("Quantity", startX + 360, y);
          doc.text("Notes", startX + 420, y);

          y += 20;
          doc.moveTo(50, y).lineTo(550, y).stroke();
          y += 10;

          doc.font("Helvetica");
        }

        doc.text((index + 1).toString(), startX, y);
        doc.text(item.medicine.name, startX + 40, y);
        doc.text(item.medicine.manufacturer || "-", startX + 180, y);
        doc.text(item.medicine.form || "-", startX + 300, y);
        doc.text(item.quantity.toString(), startX + 360, y);
        doc.text(item.notes || "-", startX + 420, y);

        y += 30;
      });

      // Add footer
      doc.fontSize(10);
      const bottomY = doc.page.height - 50;
      doc.text(`Generated on: ${new Date().toLocaleString()}`, {
        align: "center",
      });

      // Finalize PDF
      doc.end();

      // Return the path when the stream is closed
      stream.on("finish", () => {
        resolve(outputPath);
      });

      stream.on("error", (err) => {
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Send PDF via WhatsApp
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} phoneNumber - Phone number to send to
 * @returns {Promise<boolean>} - Success status
 */
export const sendPDFViaWhatsApp = async (pdfPath, phoneNumber) => {
  try {
    // This is a placeholder for the actual WhatsApp Business API integration
    // You would need to integrate with a service like Twilio, MessageBird, or the WhatsApp Business API directly

    // Mock successful sending
    return true;

    /* Actual implementation would look something like this:
    
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`,
      body: `Medicine order list from ${storeName}`,
      mediaUrl: pdfUrl // You would need to upload the PDF to a publicly accessible URL first
    });
    
    return true;
    */
  } catch (error) {
    console.error("Error sending PDF via WhatsApp:", error);
    return false;
  }
};

// Helper function to delete old PDFs
export const cleanupOldPDFs = async () => {
  try {
    const directory = path.join(__dirname, "..", "uploads", "pdfs");
    const files = fs.readdirSync(directory);

    const now = new Date();

    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);

      // Delete files older than 24 hours
      const fileAge = now - stats.mtime;
      if (fileAge > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (error) {
    console.error("Error cleaning up old PDFs:", error);
  }
};
