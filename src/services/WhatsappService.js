// whatsapp.service.js
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

/**
 * WhatsApp integration service
 * This is a simplified example for integrating with WhatsApp Business API
 * You may need to adapt this based on the specific WhatsApp Business API provider you use
 */
export default class WhatsAppService {
  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL;
    this.apiToken = process.env.WHATSAPP_API_TOKEN;
    this.fromNumber = process.env.WHATSAPP_FROM_NUMBER;
  }

  /**
   * Send a text message via WhatsApp
   * @param {string} to - Recipient's phone number with country code
   * @param {string} message - Message text
   * @returns {Promise<Object>} - API response
   */
  async sendTextMessage(to, message) {
    try {
      const response = await axios.post(
        `${this.apiUrl}/messages`,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "text",
          text: {
            body: message,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error("Error sending WhatsApp text message:", error);
      throw error;
    }
  }

  /**
   * Send a PDF file via WhatsApp
   * @param {string} to - Recipient's phone number with country code
   * @param {string} pdfPath - Path to the PDF file
   * @param {string} caption - Caption for the document
   * @returns {Promise<Object>} - API response
   */
  async sendPDF(to, pdfPath, caption) {
    try {
      // First upload the document to get a media ID
      const mediaId = await this.uploadMedia(pdfPath, "application/pdf");

      // Then send the document with the media ID
      const response = await axios.post(
        `${this.apiUrl}/messages`,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "document",
          document: {
            id: mediaId,
            caption: caption,
            filename: pdfPath.split("/").pop(),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error("Error sending WhatsApp PDF:", error);
      throw error;
    }
  }

  /**
   * Upload a media file to WhatsApp servers
   * @param {string} filePath - Path to the file
   * @param {string} mimeType - MIME type of the file
   * @returns {Promise<string>} - Media ID
   */
  async uploadMedia(filePath, mimeType) {
    try {
      const formData = new FormData();
      formData.append("messaging_product", "whatsapp");
      formData.append("file", fs.createReadStream(filePath), {
        contentType: mimeType,
      });

      const response = await axios.post(`${this.apiUrl}/media`, formData, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          ...formData.getHeaders(),
        },
      });

      return response.data.id;
    } catch (error) {
      console.error("Error uploading media to WhatsApp:", error);
      throw error;
    }
  }

  /**
   * Send a template message with a PDF attachment
   * @param {string} to - Recipient's phone number with country code
   * @param {string} templateName - Name of the template to use
   * @param {Array} components - Template components
   * @param {string} pdfPath - Path to the PDF file
   * @returns {Promise<Object>} - API response
   */
  async sendTemplateWithPDF(to, templateName, components, pdfPath) {
    try {
      // First upload the document to get a media ID
      const mediaId = await this.uploadMedia(pdfPath, "application/pdf");

      // Create template message with document
      const templateMessage = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: "en_US",
          },
          components: [
            ...components,
            {
              type: "header",
              parameters: [
                {
                  type: "document",
                  document: {
                    id: mediaId,
                    filename: pdfPath.split("/").pop(),
                  },
                },
              ],
            },
          ],
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/messages`,
        templateMessage,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error("Error sending WhatsApp template with PDF:", error);
      throw error;
    }
  }
}
