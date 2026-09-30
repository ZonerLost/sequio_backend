import { DisputeModel, IDispute, DisputeStatus } from "../models/dispute.model";

export class DisputeRepository {
  async create(data: Partial<IDispute>): Promise<IDispute> {
    return DisputeModel.create(data);
  }

  async findById(id: string): Promise<IDispute | null> {
    return DisputeModel.findById(id)
      .populate("booking", "startDate endDate item status")
      .populate("reportedBy", "firstName lastName profilePhoto")
      .populate("reportedAgainst", "firstName lastName profilePhoto")
      .populate("resolvedBy", "firstName lastName");
  }

  /**
   * A user's disputes — **both sides**. Filtering on reportedBy alone meant a user could never see a
   * dispute filed against them, while `uploadEvidence` and `GET /disputes/:id` already let them act
   * on one, so the id simply had to be guessed. `role` narrows it when a screen wants one side.
   */
  async findByUser(
    userId: string,
    opts: {
      status?: string;
      role?: "reporter" | "against" | "all";
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ disputes: IDispute[]; total: number }> {
    const { status, role = "all", page = 1, limit = 10 } = opts;

    const party =
      role === "reporter"
        ? { reportedBy: userId }
        : role === "against"
          ? { reportedAgainst: userId }
          : { $or: [{ reportedBy: userId }, { reportedAgainst: userId }] };

    const filter = { ...party, ...(status ? { status } : {}) };

    const [disputes, total] = await Promise.all([
      DisputeModel.find(filter)
        .populate("booking", "startDate endDate status")
        // both parties are populated: the list has to say who filed it, not just who it is against
        .populate("reportedBy", "firstName lastName profilePhoto")
        .populate("reportedAgainst", "firstName lastName profilePhoto")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      DisputeModel.countDocuments(filter),
    ]);
    return { disputes, total };
  }

  async existsByBookingAndUser(bookingId: string, userId: string): Promise<boolean> {
    const count = await DisputeModel.countDocuments({
      booking: bookingId,
      reportedBy: userId,
    });
    return count > 0;
  }

  async updateStatus(
    id: string,
    status: DisputeStatus,
    extra: Partial<IDispute> = {}
  ): Promise<IDispute | null> {
    return DisputeModel.findByIdAndUpdate(
      id,
      { status, ...extra },
      { new: true }
    );
  }

  async addEvidence(id: string, urls: string[]): Promise<IDispute | null> {
    return DisputeModel.findByIdAndUpdate(
      id,
      { $push: { evidence: { $each: urls } } },
      { new: true }
    );
  }

  // Admin methods
  async findAll(
    status?: string,
    page = 1,
    limit = 10
  ): Promise<{ disputes: IDispute[]; total: number }> {
    const filter: Record<string, any> = {};
    if (status) filter.status = status;

    const [disputes, total] = await Promise.all([
      DisputeModel.find(filter)
        .populate("booking", "startDate endDate status")
        .populate("reportedBy", "firstName lastName email")
        .populate("reportedAgainst", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      DisputeModel.countDocuments(filter),
    ]);
    return { disputes, total };
  }
}