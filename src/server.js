import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import connectDB from "./config/db.js";
import authrouter from "./routes/authRoutes.js";
import cookieParser from "cookie-parser";
import productRouter from "./routes/productRoutes.js";
import path from "path";
import { fileURLToPath } from "url";

import categoryrouter from "./routes/categoryRoutes.js";
import customerRouter from "./routes/customerRoutes.js";
import paymentRouter from "./routes/paymentRoutes.js";
import salesRouter from "./routes/salesRoutes.js";
import storeRouter from "./routes/storeRoutes.js";
import subcriptionRouter from "./routes/subcriptionRoutes.js";
import supplierRouter from "./routes/suppierRoutes.js";
import medicalRaprouter from "./routes/medicalRapRoutes.js";

dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use(
  cors({
    // origin: "*", // Allow all origins (change this to specific origins in production)
    // credentials: true,
  })
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(morgan("dev"));
app.use(cookieParser());

app.use("/api/auth", authrouter);
app.use("/api/product", productRouter);
app.use("/api/category", categoryrouter);
app.use("/api/customer", customerRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/sales", salesRouter);
app.use("/api/store", storeRouter);
app.use("/api/subcription", subcriptionRouter);
app.use("/api/supplier", supplierRouter);
app.use("/api/medicines", medicalRaprouter);

app.use(
  "/uploads/prescriptions",
  express.static(path.join(__dirname, "uploads/prescriptions"))
);
// Add this to your server.js after all routes are registered
// app._router.stack.forEach(function (r) {
//   if (r.route && r.route.path) {
//     console.log(r.route.path);
//   } else if (r.name === "router") {
//     r.handle.stack.forEach(function (r) {
//       if (r.route && r.route.path) {
//         console.log(r.route.path);
//       }
//     });
//   }
// });
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
app.get("/", (req, res) => res.send("HEllo world"));
