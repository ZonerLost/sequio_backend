import mongoose, { Schema, Document } from "mongoose";

/** A message is text, or an image with an optional caption carried in `content`. */
export type MessageType = "text" | "image";

export interface IMessage extends Document {
  _id: mongoose.Types.ObjectId;
  conversation: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  content: string;
  type: MessageType;
  imageUrl?: string;
  isRead: boolean;
  deliveredAt?: Date;
  readAt?: Date;
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
    type?: MessageType;
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
    // An image message may have no caption at all, so content is required for text only.
    content: {
      type: String,
      required: function (this: IMessage) {
        return this.type !== "image";
      },
      trim: true,
      maxlength: 2000,
    },
    type: { type: String, enum: ["text", "image"], default: "text" },
    imageUrl: { type: String },
    isRead: { type: Boolean, default: false },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ sender: 1 });
// receipt sweeps: unread / undelivered messages addressed to a participant
MessageSchema.index({ conversation: 1, sender: 1, readAt: 1 });
MessageSchema.index({ conversation: 1, sender: 1, deliveredAt: 1 });

const ConversationSchema = new Schema<IConversation>(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    item: { type: Schema.Types.ObjectId, ref: "Item" },
    lastMessage: {
      content: String,
      sender: { type: Schema.Types.ObjectId, ref: "User" },
      createdAt: Date,
      // denormalised so a conversation list can render "photo" without fetching the message
      type: { type: String, enum: ["text", "image"] },
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