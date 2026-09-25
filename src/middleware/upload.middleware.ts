import multer from "multer";
import { CONSTANTS, HTTP_STATUS } from "../config/constants";
import { AppError } from "./error.middleware";

const storage = multer.memoryStorage();

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (CONSTANTS.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    // An AppError so the handler answers 400; a bare Error here fell through to 500.
    cb(new AppError("Only JPEG, PNG and WebP images are allowed", HTTP_STATUS.BAD_REQUEST));
  }
};

export const upload = multer({
  storage,
  limits: { fileSize: CONSTANTS.MAX_FILE_SIZE },
  fileFilter,
});