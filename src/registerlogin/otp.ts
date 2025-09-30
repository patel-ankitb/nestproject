import { Injectable, InternalServerErrorException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';
import mongoose from 'mongoose';
import { RegisterLoginService } from './registerlogin.service';

@Injectable()
export class OtpService {
  constructor(
    @Inject(forwardRef(() => RegisterLoginService))
    private readonly registerLoginService: RegisterLoginService,
  ) {}

  private generateOtp(length: number = 6): string {
    return crypto
      .randomInt(Math.pow(10, length - 1), Math.pow(10, length))
      .toString();
  }

  // ===== SEND OTP =====
  async sendOtp(uniqueId: string, otpLength: number, expiresInMinutes: number, appName: string, type: number) {
    try {
      const otp = this.generateOtp(otpLength);

      const { cn_str, dbName } = await this.registerLoginService.resolveAppConfig(appName);
      const conn = await mongoose.createConnection(cn_str, { dbName }).asPromise();
      const db = conn.useDb(dbName);

      const otpCollection = db.collection('otp_logs');

      await otpCollection.insertOne({
        uniqueId,
        appName,
        otp,
        createdAt: new Date(),
        expireAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      });

      console.log(`OTP for ${uniqueId}: ${otp}`); // For testing
      return { success: true, message: 'OTP sent successfully' };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  // ===== VERIFY OTP =====
  async verifyOtp(uniqueId: string, otp: string, appName: string) {
    try {
      const { cn_str, dbName } = await this.registerLoginService.resolveAppConfig(appName);
      const conn = await mongoose.createConnection(cn_str, { dbName }).asPromise();
      const db = conn.useDb(dbName);

      const otpCollection = db.collection('otp_logs');

      const now = new Date();
      const record = await otpCollection.findOne({
        uniqueId,
        appName,
        expireAt: { $gt: now }, // Check if OTP is not expired
      });

      if (!record) {
        throw new BadRequestException('OTP not found or expired');
      }

      if (record.otp !== otp) {
        throw new BadRequestException('Invalid OTP');
      }

      // Delete OTP after successful verification
      await otpCollection.deleteOne({ _id: record._id });

      return { success: true, message: 'OTP verified successfully' };
    } catch (err: any) {
      if (err.status === 400) throw err; // pass through BadRequestException
      throw new InternalServerErrorException(err.message);
    }
  }
}
