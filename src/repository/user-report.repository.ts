import { UserReportModel, IUserReport, ReportReason } from "../models/user-report.model";

export class UserReportRepository {
  async create(data: {
    reportedBy: string;
    reportedUser: string;
    reason: ReportReason;
    description?: string;
    conversationId?: string;
  }): Promise<IUserReport> {
    return UserReportModel.create(data);
  }

  async findExisting(reportedBy: string, reportedUser: string): Promise<IUserReport | null> {
    return UserReportModel.findOne({ reportedBy, reportedUser }).exec();
  }

  async findByReporter(reportedBy: string): Promise<IUserReport[]> {
    return UserReportModel.find({ reportedBy })
      .populate("reportedUser", "firstName lastName profilePhoto")
      .sort({ createdAt: -1 });
  }
}
