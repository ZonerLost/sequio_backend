import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  _id: mongoose.Types.ObjectId;
  conversation: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  content: string;
  isRead: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversation extends Document {
  _id: mongoose.Types.ObjectId;
  participants: mongoose.Types.ObjectId[];
  item?: mongoose.Types.ObjectId;
  lastMessage?: {
    content: string;
    sender: mongoose.Types.ObjectId;
    createdAt: Date;
  };
  unreadCount: Map<string, number>;
  archivedBy: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    isRead: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ sender: 1 });

const ConversationSchema = new Schema<IConversation>(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    item: { type: Schema.Types.ObjectId, ref: "Item" },
    lastMessage: {
      content: String,
      sender: { type: Schema.Types.ObjectId, ref: "User" },
      createdAt: Date,
    },
    unreadCount: { type: Map, of: Number, default: {} },
    archivedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ updatedAt: -1 });

export const MessageModel = mongoose.model<IMessage>("Message", MessageSchema);
export const ConversationModel = mongoose.model<IConversation>("Conversation", ConversationSchema);