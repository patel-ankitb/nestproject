import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { RegisterLoginService } from './registerlogin.service';
import { EmailService } from './emailservice';

@Injectable()
export class OtpService {
  constructor(
    @Inject(forwardRef(() => RegisterLoginService))
    private readonly registerLoginService: RegisterLoginService,
    private readonly emailService: EmailService,
  ) {}

  private generateOtp(length = 4): string {
    return crypto
      .randomInt(Math.pow(10, length - 1), Math.pow(10, length))
      .toString();
  }

  async sendOtp(
    uniqueId: string,
    otpLength = 4,
    expiresInMinutes = 2,
    appName: string,
  ) {
    try {
      // Demo user gets fixed OTP
      const otp: string =
        uniqueId === 'hanademo@mail.com'
          ? '9999'
          : this.generateOtp(otpLength);

      const { cn_str, dbName } =
        await this.registerLoginService.resolveAppConfig(appName);
      const conn = await this.registerLoginService.getConnection(
        cn_str,
        dbName,
      );
      const db = conn.useDb(dbName);
      const otpCollection = db.collection('otp');

      // Ensure TTL index exists (expiresAt field)
      await otpCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 },
      );

      // Store OTP with expiry
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
      await otpCollection.insertOne({
        uniqueId,
        otp,
        appName,
        expiresAt,
        createdAt: new Date(),
      });

      // Send OTP via email
      await this.emailService.sendOtpEmail(uniqueId, otp);

      return { success: true, message: `OTP sent to ${uniqueId}` };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async verifyOtp(uniqueId: string, otp: string, appName: string) {
    try {
      const { cn_str, dbName } =
        await this.registerLoginService.resolveAppConfig(appName);
      const conn = await this.registerLoginService.getConnection(
        cn_str,
        dbName,
      );
      const db = conn.useDb(dbName);
      const otpCollection = db.collection('otp');

      const record = await otpCollection.findOne({ uniqueId, appName });

      if (!record) {
        throw new BadRequestException('OTP has expired or not found');
      }
      if (record.otp !== otp) {
        throw new BadRequestException('Invalid OTP');
      }

      // Delete OTP after success
      await otpCollection.deleteOne({ _id: record._id });

      return { success: true, message: 'OTP verified successfully' };
    } catch (err: any) {
      if (err.status === 400) throw err;
      throw new InternalServerErrorException(err.message);
    }
  }
}
