import { Document, Types } from "mongoose";

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  profilePhoto?: string;
  bio?: string;
  dateOfBirth?: Date;
  location?: {
    address?: string;
    city: string;
    province: string;
    country: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  language: "en" | "fr";
  authProvider: "email" | "google" | "facebook";
  googleId?: string;
  facebookId?: string;
  isEmailVerified: boolean;
  isIdentityVerified: boolean;
  identityDocument?: string;
  rentalHistory: Types.ObjectId[];
  lendingHistory: Types.ObjectId[];
  averageRating: number;
  totalReviews: number;
  role: "user" | "admin";
  isActive: boolean;
  isBanned: boolean;
  lastLoginAt?: Date;
  fcmToken?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IItem extends Document {
  _id: Types.ObjectId;
  owner: Types.ObjectId;
  title: string;
  description: string;
  category: string;
  subCategory?: string;
  photos: string[];
  dailyRate: number;
  currency: string;
  location: {
    address: string;
    city: string;
    province: string;
    country: string;
    coordinates: {
      lat: number;
      lng: number;
    };
  };
  availability: {
    isAvailable: boolean;
    blockedDates: Date[];
    availableFrom?: Date;
    availableTo?: Date;
  };
  deliveryOptions: {
    pickup: boolean;
    delivery: boolean;
    deliveryRadius?: number;
  };
  weeklyRate?: number;
  monthlyRate?: number;
  depositAmount: number;
  minRentalDays: number;
  maxRentalDays?: number;
  quantity: number;
  isPaused: boolean;
  condition: "new" | "like_new" | "good" | "fair";
  isFeatured: boolean;
  featuredUntil?: Date;
  averageRating: number;
  totalReviews: number;
  totalRentals: number;
  isActive: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOtp extends Document {
  userId: Types.ObjectId;
  email: string;
  otp: string;
  type: "email_verification" | "password_reset";
  expiresAt: Date;
  isUsed: boolean;
}

export interface IRefreshToken extends Document {
  userId: Types.ObjectId;
  token: string;
  expiresAt: Date;
  isRevoked: boolean;
  deviceInfo?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: unknown;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}