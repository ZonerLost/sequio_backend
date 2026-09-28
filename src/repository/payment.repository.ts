import {
  PaymentModel,
  IPayment,
  SavedPaymentMethodModel,
  ISavedPaymentMethod,
  PaymentStatus,
} from "../models/payment.model";

export class PaymentRepository {
  // ── Payments ──────────────────────────────────────────────

  async create(data: Partial<IPayment>): Promise<IPayment> {
    return PaymentModel.create(data);
  }

  // What a transaction row needs to render: who, what booking, and which card it was paid with.
  private static readonly METHOD_FIELDS = "type label card.brand card.last4";

  async findById(id: string): Promise<IPayment | null> {
    return PaymentModel.findById(id)
      .populate("booking", "startDate endDate totalDays item")
      .populate("payer", "firstName lastName")
      .populate("payee", "firstName lastName")
      .populate("paymentMethod", PaymentRepository.METHOD_FIELDS);
  }

  /** Only a completed payment blocks another attempt; a failed one must not. */
  async findCompletedByBooking(bookingId: string): Promise<IPayment | null> {
    return PaymentModel.findOne({ booking: bookingId, status: "completed" });
  }

  async findForUser(
    userId: string,
    role: "payer" | "payee" | "all",
    page = 1,
    limit = 10
  ): Promise<{ payments: IPayment[]; total: number }> {
    const filter =
      role === "payer"
        ? { payer: userId }
        : role === "payee"
          ? { payee: userId }
          : { $or: [{ payer: userId }, { payee: userId }] };

    const [payments, total] = await Promise.all([
      PaymentModel.find(filter)
        .populate("booking", "startDate endDate item")
        .populate("payer", "firstName lastName")
        .populate("payee", "firstName lastName")
        .populate("paymentMethod", PaymentRepository.METHOD_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      PaymentModel.countDocuments(filter),
    ]);
    return { payments, total };
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    extra: Partial<IPayment> = {}
  ): Promise<IPayment | null> {
    return PaymentModel.findByIdAndUpdate(
      id,
      { status, ...extra },
      { new: true }
    );
  }

  // ── Saved Payment Methods ─────────────────────────────────

  /**
   * The invariant across these four methods: a user with at least one saved method has exactly one
   * default. The first method saved becomes the default even without asking, and the flag is always
   * *set* before the others are cleared — clearing first leaves a window with no default at all.
   */
  async saveMethod(data: Partial<ISavedPaymentMethod>): Promise<ISavedPaymentMethod> {
    const existing = await SavedPaymentMethodModel.countDocuments({ user: data.user });
    const isDefault = data.isDefault || existing === 0;

    const created = await SavedPaymentMethodModel.create({ ...data, isDefault });
    if (isDefault) {
      await SavedPaymentMethodModel.updateMany(
        { user: data.user, _id: { $ne: created._id } },
        { isDefault: false }
      );
    }
    return created;
  }

  async getMethodsByUser(userId: string): Promise<ISavedPaymentMethod[]> {
    return SavedPaymentMethodModel.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 });
  }

  async findMethodById(id: string, userId: string): Promise<ISavedPaymentMethod | null> {
    return SavedPaymentMethodModel.findOne({ _id: id, user: userId });
  }

  /** Returns the deleted document so the caller can 404, and the promoted default if one was needed. */
  async deleteMethod(
    id: string,
    userId: string
  ): Promise<{ deleted: ISavedPaymentMethod | null; promoted: ISavedPaymentMethod | null }> {
    const deleted = await SavedPaymentMethodModel.findOneAndDelete({ _id: id, user: userId });
    if (!deleted) return { deleted: null, promoted: null };

    // Removing the default would otherwise leave the user with none.
    let promoted: ISavedPaymentMethod | null = null;
    if (deleted.isDefault) {
      promoted = await SavedPaymentMethodModel.findOneAndUpdate(
        { user: userId },
        { isDefault: true },
        { sort: { createdAt: -1 }, new: true }
      );
    }
    return { deleted, promoted };
  }

  /** Null when the id is not this user's, so the caller can 404 instead of silently clearing flags. */
  async setDefaultMethod(id: string, userId: string): Promise<ISavedPaymentMethod | null> {
    const target = await SavedPaymentMethodModel.findOneAndUpdate(
      { _id: id, user: userId },
      { isDefault: true },
      { new: true }
    );
    if (!target) return null;

    await SavedPaymentMethodModel.updateMany(
      { user: userId, _id: { $ne: target._id } },
      { isDefault: false }
    );
    return target;
  }
}