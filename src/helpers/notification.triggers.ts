import { notificationService } from "../services/notification.service";

// Called after booking is created
export async function notifyBookingRequest(
  ownerId: string,
  renterName: string,
  itemTitle: string,
  bookingId: string
): Promise<void> {
  await notificationService.send({
    userId: ownerId,
    type: "booking_request",
    title: "New Booking Request",
    body: `${renterName} has requested to rent your "${itemTitle}"`,
    data: { bookingId, screen: "booking_detail" },
  });
}

// Called after owner accepts booking
export async function notifyBookingAccepted(
  renterId: string,
  itemTitle: string,
  bookingId: string
): Promise<void> {
  await notificationService.send({
    userId: renterId,
    type: "booking_accepted",
    title: "Booking Accepted!",
    body: `Your booking request for "${itemTitle}" has been accepted`,
    data: { bookingId, screen: "booking_detail" },
  });
}

// Called after owner declines booking
export async function notifyBookingDeclined(
  renterId: string,
  itemTitle: string,
  bookingId: string
): Promise<void> {
  await notificationService.send({
    userId: renterId,
    type: "booking_declined",
    title: "Booking Declined",
    body: `Your booking request for "${itemTitle}" was declined`,
    data: { bookingId, screen: "booking_detail" },
  });
}

// Called after renter cancels booking
export async function notifyBookingCancelled(
  ownerId: string,
  renterName: string,
  itemTitle: string,
  bookingId: string
): Promise<void> {
  await notificationService.send({
    userId: ownerId,
    type: "booking_cancelled",
    title: "Booking Cancelled",
    body: `${renterName} cancelled the booking for "${itemTitle}"`,
    data: { bookingId, screen: "booking_detail" },
  });
}

/**
 * Called when an administrator cancels a booking.
 *
 * Both parties are told, and the reason is included: a cancellation nobody asked for is confusing
 * enough without it being unexplained, and the renter needs to know a booking they paid for is off.
 */
/**
 * Tells the other party that the recorded return time is being contested.
 *
 * Worth a notification rather than a quiet flag: the 24-hour inspection window, the deposit release
 * and the claim deadline all run from that timestamp, so someone disagreeing with it is time-critical
 * for both of them.
 */
export async function notifyReturnTimeDisputed(
  userId: string,
  bookingId: string,
  reason: string
): Promise<void> {
  if (!userId) return;
  await notificationService.send({
    userId,
    type: "return_time_disputed",
    title: "Return time contested",
    body: `The other party disagrees with the recorded return time: ${reason}`,
    data: { bookingId, screen: "booking_detail" },
  });
}

/**
 * Tells the renter their owner pulled out.
 *
 * The refund status is in the body on purpose. "Your booking is cancelled" without saying what
 * happened to the money they already paid is the message most likely to generate a support ticket.
 */
export async function notifyBookingCancelledByOwner(
  userId: string,
  itemTitle: string,
  bookingId: string,
  explanation: string,
  refunded: boolean
): Promise<void> {
  if (!userId) return;
  await notificationService.send({
    userId,
    type: "owner_cancelled",
    title: "Booking cancelled by the owner",
    body:
      `The owner cancelled your booking for "${itemTitle}": ${explanation}. ` +
      (refunded
        ? "You have been refunded in full."
        : "Your refund is being processed and support has been notified."),
    data: { bookingId, screen: "booking_detail" },
  });
}

/**
 * Tells an owner where they stand after cancelling.
 *
 * Deliberately explicit about the count and what comes next. A warning nobody understood is a
 * suspension that arrives as a surprise, and the appeal route has to be obvious.
 */
export async function notifyOwnerStrike(
  userId: string,
  outcome: "warning" | "final_warning" | "suspension",
  strikeNumber: number,
  suspensionDays: number
): Promise<void> {
  if (!userId) return;
  const body =
    outcome === "suspension"
      ? `This is your third cancellation in 90 days, so you cannot receive new bookings for ${suspensionDays} days. Contact support if you believe this is wrong — every cancellation is reviewed.`
      : outcome === "final_warning"
        ? "This is your second cancellation in 90 days. A third within the same period will temporarily stop you receiving new bookings."
        : "Cancelling a confirmed booking affects the renter's plans. Repeated cancellations within 90 days can stop you receiving new bookings.";

  await notificationService.send({
    userId,
    type: "owner_strike",
    title: outcome === "suspension" ? "Your listings are temporarily suspended" : "Cancellation recorded",
    body,
    data: { strikeNumber: String(strikeNumber), screen: "my_listings" },
  });
}

export async function notifyBookingCancelledByAdmin(
  userIds: string[],
  itemTitle: string,
  bookingId: string,
  reason: string
): Promise<void> {
  await Promise.all(
    userIds.filter(Boolean).map((userId) =>
      notificationService.send({
        userId,
        type: "booking_cancelled",
        title: "Booking Cancelled by Support",
        body: `The booking for "${itemTitle}" was cancelled by Atussa support: ${reason}`,
        data: { bookingId, screen: "booking_detail" },
      })
    )
  );
}

// Called after booking is completed
export async function notifyBookingCompleted(
  renterId: string,
  itemTitle: string,
  bookingId: string
): Promise<void> {
  await notificationService.send({
    userId: renterId,
    type: "booking_completed",
    title: "Rental Completed",
    body: `Your rental of "${itemTitle}" is complete. Leave a review!`,
    data: { bookingId, screen: "review" },
  });
}

// Called after a review is submitted
export async function notifyReviewReceived(
  revieweeId: string,
  reviewerName: string,
  rating: number
): Promise<void> {
  await notificationService.send({
    userId: revieweeId,
    type: "review_received",
    title: "New Review",
    body: `${reviewerName} gave you a ${rating}-star review`,
    data: { screen: "profile" },
  });
}

// Called after a message is sent
export async function notifyMessageReceived(
  recipientId: string,
  senderName: string,
  conversationId: string
): Promise<void> {
  await notificationService.send({
    userId: recipientId,
    type: "message_received",
    title: "New Message",
    body: `${senderName} sent you a message`,
    data: { conversationId, screen: "chat" },
  });
}

/**
 * Tells the owner a renter cancelled, and what the policy did about the money.
 *
 * Separate from `notifyBookingCancelled`, which says only that it happened. An owner whose booking
 * is cancelled 30 hours before the start keeps part of the price and is being asked to decide about
 * the rest — "X cancelled" alone leaves them to work that out from a balance statement later.
 */
export async function notifyCancellationSettlement(
  ownerId: string,
  itemTitle: string,
  bookingId: string,
  body: string
): Promise<void> {
  if (!ownerId) return;
  await notificationService.send({
    userId: ownerId,
    type: "booking_cancelled_refund",
    title: `Cancelled: ${itemTitle}`,
    body,
    data: { bookingId, screen: "booking_detail" },
  });
}

/**
 * Tells the owner a refund is waiting on their decision.
 *
 * The amount is in the body on purpose: this is a request to give money back, and a notification
 * that does not say how much is one the owner has to open the app to understand.
 */
export async function notifyRefundRequested(
  ownerId: string,
  renterName: string,
  itemTitle: string,
  bookingId: string,
  requestId: string,
  amountLabel: string
): Promise<void> {
  if (!ownerId) return;
  await notificationService.send({
    userId: ownerId,
    type: "refund_requested",
    title: "Refund requested",
    body: `${renterName} is asking for ${amountLabel} back on "${itemTitle}". You can approve part of it, all of it, or decline.`,
    data: { bookingId, requestId, screen: "booking_detail" },
  });
}

/** Tells the renter the owner agreed, and to how much — which may be less than they asked for. */
export async function notifyRefundApproved(
  renterId: string,
  itemTitle: string,
  bookingId: string,
  requestId: string,
  amountLabel: string,
  partial: boolean
): Promise<void> {
  if (!renterId) return;
  await notificationService.send({
    userId: renterId,
    type: "refund_approved",
    title: "Refund approved",
    body: partial
      ? `The owner approved ${amountLabel} of your refund request for "${itemTitle}". It will appear on your original payment method.`
      : `The owner approved your ${amountLabel} refund for "${itemTitle}". It will appear on your original payment method.`,
    data: { bookingId, requestId, screen: "booking_detail" },
  });
}

/**
 * Tells the renter the owner said no.
 *
 * The owner's note is included when they left one. A decline with no reason is the message most
 * likely to become a support ticket, and the specification gives the renter no appeal path — so the
 * least this can do is pass on what the owner actually said.
 */
export async function notifyRefundDeclined(
  renterId: string,
  itemTitle: string,
  bookingId: string,
  requestId: string,
  note?: string
): Promise<void> {
  if (!renterId) return;
  await notificationService.send({
    userId: renterId,
    type: "refund_declined",
    title: "Refund declined",
    body: note
      ? `The owner declined your refund request for "${itemTitle}": ${note}`
      : `The owner declined your refund request for "${itemTitle}".`,
    data: { bookingId, requestId, screen: "booking_detail" },
  });
}
