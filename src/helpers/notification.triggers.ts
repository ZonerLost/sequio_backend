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