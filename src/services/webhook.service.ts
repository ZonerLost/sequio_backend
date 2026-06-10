import { UserRepository } from "../repository/user.repository";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { ENV } from "../config/env";

const userRepo = new UserRepository();

// Product IDs that represent a boost purchase — must match App Store / Play Store / RevenueCat dashboard
const BOOST_PRODUCT_IDS = ["boost_7days", "com.ziprental.boost_7days"];

export class WebhookService {
  verifyRevenueCatSignature(authHeader: string | undefined): void {
    if (!ENV.REVENUECAT_WEBHOOK_SECRET) return; // skip verification in dev if secret not set
    if (authHeader !== ENV.REVENUECAT_WEBHOOK_SECRET) {
      throw new AppError("Unauthorized webhook", HTTP_STATUS.UNAUTHORIZED);
    }
  }

  async handleRevenueCatEvent(payload: Record<string, unknown>): Promise<void> {
    const event = payload.event as Record<string, unknown> | undefined;
    if (!event) return;

    const eventType = event.type as string;
    const appUserId = event.app_user_id as string; // must be our MongoDB user _id
    const productId = event.product_id as string;

    // Only handle initial boost purchases
    if (eventType !== "INITIAL_PURCHASE") return;
    if (!BOOST_PRODUCT_IDS.includes(productId)) return;
    if (!appUserId) return;

    const user = await userRepo.findById(appUserId);
    if (!user) {
      console.error(`RevenueCat webhook: user ${appUserId} not found`);
      return; // don't throw — return 200 so RevenueCat doesn't retry
    }

    await userRepo.updateById(appUserId, {
      $inc: { boostCredits: 1 },
    } as any);

    console.log(`RevenueCat: boost credit added to user ${appUserId} (product: ${productId})`);
  }
}
