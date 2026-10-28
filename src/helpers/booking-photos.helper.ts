import { signUrls } from "./s3.helper";

/**
 * Serves a booking's pre/post-rental condition photos as short-lived signed URLs.
 *
 * `bookings/<id>/pre-rental` and `.../post-rental` are deliberately **not** in the S3 bucket policy,
 * unlike `item-photos/` and `profile-photos/`. These are damage records — the evidence that settles
 * who pays for a scratch — and they routinely show the inside of someone's home, their vehicle, their
 * belongings. A permanent world-readable URL for that is a privacy leak that can never be withdrawn,
 * so they get the same treatment as dispute evidence: stored private, served signed, and reachable
 * only through an endpoint that has already checked the caller is a party to the booking (or an
 * admin).
 *
 * Until this existed, the upload returned a raw URL that answered **403 to everyone**. The POST
 * succeeded, the database was correct and the API response looked perfectly healthy, so the only
 * symptom was a broken thumbnail in the app — which is why it survived a month after being reported.
 * Verified against real objects on 2026-09-28 and re-confirmed on 2026-10-28.
 *
 * Three things not to break:
 *
 * 1. **The database keeps the raw URL.** `deleteFromS3` recovers the key with
 *    `split(".amazonaws.com/")[1]`, so persisting a signed URL breaks deletion permanently. This
 *    returns a plain copy; it never writes.
 * 2. **Every path that returns a booking must go through this**, including the mutations and the
 *    admin panel, so the response shape does not depend on which endpoint produced it. A single
 *    endpoint that forgets is a screen full of broken images.
 * 3. **The ownership check is load-bearing.** Signing is only safe because `getBookingById` refuses
 *    a caller who is neither party. Loosen that and the photos are effectively public again.
 */

/** One hour — long enough to open a booking and zoom a photo; short enough that a shared link dies. */
export const PHOTO_URL_TTL_SECONDS = 3600;

export const withSignedBookingPhotos = async <T>(booking: T): Promise<T> => {
  if (!booking) return booking;

  const doc = booking as unknown as { toObject?: () => Record<string, unknown> };
  const plain: Record<string, unknown> =
    typeof doc.toObject === "function"
      ? doc.toObject()
      : { ...(booking as unknown as Record<string, unknown>) };

  const pre = plain.preRentalPhotos as string[] | undefined;
  const post = plain.postRentalPhotos as string[] | undefined;
  // Nothing to sign, and nothing to promise about expiry.
  if (!pre?.length && !post?.length) return plain as unknown as T;

  const [signedPre, signedPost] = await Promise.all([
    signUrls(pre, PHOTO_URL_TTL_SECONDS),
    signUrls(post, PHOTO_URL_TTL_SECONDS),
  ]);
  plain.preRentalPhotos = signedPre;
  plain.postRentalPhotos = signedPost;
  // So a client knows when to refetch, rather than discovering expiry as a broken image.
  plain.photoUrlsExpireAt = new Date(Date.now() + PHOTO_URL_TTL_SECONDS * 1000);

  return plain as unknown as T;
};

/** The same, for a page of bookings. */
export const withSignedBookingPhotosAll = <T>(bookings: T[]): Promise<T[]> =>
  Promise.all(bookings.map((b) => withSignedBookingPhotos(b)));
