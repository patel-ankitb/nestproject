// otp.service.ts
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
import { SMSService } from './smsservicce';
import { DatabaseService } from '../databases/database.service';
import { Db } from 'mongodb';

@Injectable()
export class OtpService {
  constructor(
    @Inject(forwardRef(() => RegisterLoginService))
    private readonly registerLoginService: RegisterLoginService,
    private readonly emailService: EmailService,
    private readonly smsService: SMSService,
    private readonly databaseService: DatabaseService,
  ) {}

  private generateOtp(length = 4): string {
    return crypto
      .randomInt(Math.pow(10, length - 1), Math.pow(10, length))
      .toString();
  }

  private async getDb(appName: string): Promise<Db> {
    try {
      return await this.databaseService.getAppDB(appName);
    } catch (err) {
      throw new InternalServerErrorException('Unable to resolve database for app');
    }
  }

  // ===== Unified OTP sender =====
  async sendOtp(uniqueId: string, otpLength = 4, expiresInMinutes = 2, appName: string) {
    try {
      // Generate OTP (fixed for demo emails)
      const otp: string =
        uniqueId === 'hanademo@mail.com' ? '9999' : this.generateOtp(otpLength);

      const db = await this.getDb(appName);
      const otpCollection = db.collection('otp');

      // Ensure TTL index exists
      await otpCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

      // ✅ Upsert OTP (only one active OTP per user/app)
      await otpCollection.updateOne(
        { uniqueId, appName },
        {
          $set: {
            otp,
            appName,
            uniqueId,
            expiresAt,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      // Determine channel: mobile vs email
      const isMobile = /^\+\d{7,15}$/.test(uniqueId);
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uniqueId);

      if (isMobile) {
        await this.smsService.sendSMS(db, uniqueId, `Your OTP is: ${otp}`, 'otp');
      } else if (isEmail) {
        await this.emailService.sendOtpEmail(uniqueId, otp);
      } else {
        throw new BadRequestException(`Invalid mobile/email: ${uniqueId}`);
      }

      // ✅ For DEV only → also return OTP in response
      return { success: true, message: `OTP sent to ${uniqueId}`, otp };

    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  // ===== OTP verification =====
  async verifyOtp(uniqueId: string, otp: string, appName: string) {
    try {
      const db = await this.getDb(appName);
      const otpCollection = db.collection('otp');
      console.log("verifying OTP for:", db);
      const record = await otpCollection.findOne({ uniqueId, appName });
      console.log('OTP Record:', record);

      if (!record) throw new BadRequestException('OTP has expired or not found');

      // ✅ Check expiry manually
      if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
        await otpCollection.deleteOne({ _id: record._id }); // cleanup
        throw new BadRequestException('OTP has expired');
      }

      // ✅ Check OTP match
      if (record.otp !== otp) throw new BadRequestException('Invalid OTP');

      // ✅ OTP verified → delete immediately
      await otpCollection.deleteOne({ _id: record._id });

      return { success: true, message: 'OTP verified successfully' };
    } catch (err: any) {
      if (err.status === 400) throw err;
      throw new InternalServerErrorException(err.message);
    }
  }
}
