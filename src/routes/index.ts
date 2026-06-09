import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import itemRoutes from "./item.routes";
import bookingRoutes from "./booking.routes";
import reviewRoutes from "./review.routes";
import chatRoutes from "./chat.routes";
import ecoRoutes from "./eco.routes";
import notificationRoutes from "./notification.routes";
import disputeRoutes from "./dispute.routes";
import paymentRoutes from "./payment.routes";
import dashboardRoutes from "./dashboard.routes";
import adminRoutes from "./admin.routes";

const router = Router();

router.get("/health", (_, res) => {
  res.json({
    success: true,
    message: "Zonerlost API is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

router.get("/languages", (_, res) => {
  res.json({
    success: true,
    message: "Supported languages retrieved",
    data: [
      { code: "en", label: "English",    nativeLabel: "English" },
      { code: "fr", label: "French",     nativeLabel: "Français" },
      { code: "es", label: "Spanish",    nativeLabel: "Español" },
      { code: "ar", label: "Arabic",     nativeLabel: "العربية" },
      { code: "zh", label: "Chinese",    nativeLabel: "中文" },
      { code: "hi", label: "Hindi",      nativeLabel: "हिन्दी" },
      { code: "pt", label: "Portuguese", nativeLabel: "Português" },
      { code: "de", label: "German",     nativeLabel: "Deutsch" },
      { code: "it", label: "Italian",    nativeLabel: "Italiano" },
      { code: "ur", label: "Urdu",       nativeLabel: "اردو" },
      { code: "pa", label: "Punjabi",    nativeLabel: "ਪੰਜਾਬੀ" },
      { code: "tr", label: "Turkish",    nativeLabel: "Türkçe" },
      { code: "ko", label: "Korean",     nativeLabel: "한국어" },
      { code: "ja", label: "Japanese",   nativeLabel: "日本語" },
      { code: "ru", label: "Russian",    nativeLabel: "Русский" },
    ],
  });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/items", itemRoutes);
router.use("/bookings", bookingRoutes);
router.use("/reviews", reviewRoutes);
router.use("/chats", chatRoutes);
router.use("/eco", ecoRoutes);
router.use("/notifications", notificationRoutes);
router.use("/disputes", disputeRoutes);
router.use("/payments", paymentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/admin", adminRoutes);
export default router;