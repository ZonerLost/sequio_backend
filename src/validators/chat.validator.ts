import Joi from "joi";

export const startConversationSchema = Joi.object({
  participantId: Joi.string().required(),
  itemId: Joi.string().optional(),
  message: Joi.string().min(1).max(2000).required(),
});

export const sendMessageSchema = Joi.object({
  content: Joi.string().min(1).max(2000).required(),
});

export const messageQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(30),
});
