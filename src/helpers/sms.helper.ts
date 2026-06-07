import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { ENV } from "../config/env";

// Uses App Runner IAM role automatically — no keys needed
const snsClient = new SNSClient({ region: ENV.AWS_REGION });

export const sendSMS = async (phoneNumber: string, message: string): Promise<void> => {
  const command = new PublishCommand({
    PhoneNumber: phoneNumber,
    Message: message,
    MessageAttributes: {
      "AWS.SNS.SMS.SMSType": {
        DataType: "String",
        StringValue: "Transactional", // Highest delivery priority, for OTPs
      },
    },
  });

  await snsClient.send(command);
};

export const sendOtpSMS = async (phoneNumber: string, otp: string): Promise<void> => {
  const message = `Zip Rental OTP: ${otp}\n\nUse this code to verify your phone number. Expires in 10 minutes. Do not share it with anyone.`;
  await sendSMS(phoneNumber, message);
};
