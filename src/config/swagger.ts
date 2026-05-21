import swaggerJsdoc from "swagger-jsdoc";
import { ENV } from "./env";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
        title: "Seqouia API",
        version: "1.0.0",
        description:
            "Peer-to-peer rental marketplace API for the Quebec market. Built with Node.js, TypeScript, and MongoDB.",
        contact: {
            name: "Seqouia Support",
            email: "seqouia@gmail.com",
        },
    },
    servers: [
      {
        url: `http://localhost:${ENV.PORT}/api/${ENV.API_VERSION}`,
        description: "Local Development Server",
      },
      {
        url: `https://au2p3vkiqi.us-east-1.awsapprunner.com/api/${ENV.API_VERSION}`,
        description: "Production Server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter your access token. Get it from /auth/login or /auth/register endpoints.",
        },
      },
      schemas: {
        // ─── Auth Schemas ───────────────────────────────
        RegisterRequest: {
          type: "object",
          required: ["email", "password", "firstName", "lastName"],
          properties: {
            email: { type: "string", example: "john@example.com" },
            password: { type: "string", example: "Password123" },
            firstName: { type: "string", example: "John" },
            lastName: { type: "string", example: "Doe" },
            language: { type: "string", enum: ["en", "fr"], example: "en" },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", example: "john@example.com" },
            password: { type: "string", example: "Password123" },
          },
        },
        VerifyEmailRequest: {
          type: "object",
          required: ["email", "otp", "type"],
          properties: {
            email: { type: "string", example: "john@example.com" },
            otp: { type: "string", example: "123456" },
            type: {
              type: "string",
              enum: ["email_verification", "password_reset"],
              example: "email_verification",
            },
          },
        },
        ForgotPasswordRequest: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", example: "john@example.com" },
          },
        },
        ResetPasswordRequest: {
          type: "object",
          required: ["email", "otp", "newPassword"],
          properties: {
            email: { type: "string", example: "john@example.com" },
            otp: { type: "string", example: "123456" },
            newPassword: { type: "string", example: "NewPassword123" },
          },
        },
        GoogleAuthRequest: {
          type: "object",
          required: ["idToken"],
          properties: {
            idToken: { type: "string", example: "google_id_token_here" },
            language: { type: "string", enum: ["en", "fr"], example: "en" },
          },
        },
        RefreshTokenRequest: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string", example: "refresh_token_here" },
          },
        },
        // ─── User Schemas ───────────────────────────────
        UpdateProfileRequest: {
          type: "object",
          properties: {
            firstName: { type: "string", example: "John" },
            lastName: { type: "string", example: "Doe" },
            phone: { type: "string", example: "+14161234567" },
            bio: { type: "string", example: "I love renting outdoor gear.", maxLength: 500 },
            dateOfBirth: { type: "string", format: "date", example: "1995-06-15" },
            language: { type: "string", enum: ["en", "fr"], example: "en" },
            location: {
              type: "object",
              properties: {
                address: { type: "string", example: "123 Main Street" },
                city: { type: "string", example: "Montreal" },
                province: { type: "string", example: "Quebec" },
                country: { type: "string", example: "Canada" },
                coordinates: {
                  type: "object",
                  properties: {
                    lat: { type: "number", example: 45.5017 },
                    lng: { type: "number", example: -73.5673 },
                  },
                },
              },
            },
          },
        },
        // ─── Item Schemas ───────────────────────────────
        CreateItemRequest: {
          type: "object",
          required: ["title", "description", "category", "dailyRate", "location", "condition"],
          properties: {
            title: { type: "string", example: "Mountain Bike - Trek 820" },
            description: {
              type: "string",
              example: "Great mountain bike, perfect for trails and city riding.",
            },
            category: { type: "string", example: "sports" },
            subCategory: { type: "string", example: "cycling" },
            dailyRate: { type: "number", example: 25 },
            weeklyRate: { type: "number", example: 140 },
            monthlyRate: { type: "number", example: 450 },
            depositAmount: { type: "number", example: 100 },
            minRentalDays: { type: "integer", example: 1 },
            maxRentalDays: { type: "integer", example: 30 },
            quantity: { type: "integer", example: 2 },
            currency: { type: "string", example: "CAD" },
            condition: {
              type: "string",
              enum: ["new", "like_new", "good", "fair"],
              example: "like_new",
            },
            deliveryOptions: {
              type: "object",
              properties: {
                pickup: { type: "boolean", example: true },
                delivery: { type: "boolean", example: true },
                deliveryRadius: { type: "number", example: 15 },
              },
            },
            availability: {
              type: "object",
              properties: {
                availableFrom: { type: "string", format: "date", example: "2026-06-01" },
                availableTo: { type: "string", format: "date", example: "2026-09-30" },
              },
            },
            location: {
              type: "object",
              required: ["city", "province"],
              properties: {
                address: { type: "string", example: "123 Main St" },
                city: { type: "string", example: "Montreal" },
                province: { type: "string", example: "Quebec" },
                country: { type: "string", example: "Canada" },
                coordinates: {
                  type: "object",
                  properties: {
                    lat: { type: "number", example: 45.5017 },
                    lng: { type: "number", example: -73.5673 },
                  },
                },
              },
            },
            tags: {
              type: "array",
              items: { type: "string" },
              example: ["bike", "mountain", "trek"],
            },
          },
        },
        UpdateAvailabilityRequest: {
          type: "object",
          properties: {
            isAvailable: { type: "boolean", example: true },
            availableFrom: { type: "string", format: "date", example: "2026-06-01" },
            availableTo: { type: "string", format: "date", example: "2026-09-30" },
            blockedDates: {
              type: "array",
              items: { type: "string", format: "date" },
              example: ["2026-07-04"],
            },
          },
        },
        // ─── Response Schemas ───────────────────────────
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful" },
            data: { type: "object" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Error message" },
            errors: { type: "array", items: { type: "string" } },
          },
        },
        PaginationMeta: {
          type: "object",
          properties: {
            page: { type: "number", example: 1 },
            limit: { type: "number", example: 10 },
            total: { type: "number", example: 100 },
            totalPages: { type: "number", example: 10 },
            hasNext: { type: "boolean", example: true },
            hasPrev: { type: "boolean", example: false },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: "Auth", description: "Authentication endpoints" },
      { name: "Users", description: "User profile management" },
      { name: "Items", description: "Item listing management" },
      { name: "Bookings", description: "Booking management" },
      { name: "Reviews", description: "Reviews and ratings" },
      { name: "Chat", description: "In-app messaging" },
      { name: "Eco Impact", description: "Environmental impact tracking and leaderboards" },
      { name: "Notifications", description: "In-app notifications" },
      { name: "Disputes", description: "Trust and safety - dispute management" },
      { name: "Payments", description: "Payment records and payment methods" },
      { name: "Dashboard", description: "User dashboard and stats" },
      { name: "Admin", description: "Admin panel endpoints (admin role required)" },
    ],
  },
  apis: ["./src/docs/*.ts", "./dist/docs/*.js"],
};

export const swaggerSpec = swaggerJsdoc(options);