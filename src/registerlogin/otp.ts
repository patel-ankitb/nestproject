// otp.service.ts
import { Injectable, InternalServerErrorException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisClientType } from 'redis';
import { RegisterLoginService } from './registerlogin.service';
import { EmailService } from './emailservice';
import { createClient } from 'redis';

@Injectable()
export class OtpService {
  private redisClient: RedisClientType;

  constructor(
    @Inject(forwardRef(() => RegisterLoginService))
    private readonly registerLoginService: RegisterLoginService,
    private readonly emailService: EmailService,
  ) {
    this.redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    this.redisClient.connect().catch(console.error);
  }

  private generateOtp(length = 4): string {
    return crypto.randomInt(Math.pow(10, length - 1), Math.pow(10, length)).toString();
  }

  async sendOtp(uniqueId: string, otpLength = 4, expiresInMinutes = 2, appName: string) {
    try {
      let otp: string;

      // Fixed OTP for certain users
      if (uniqueId === 'hanademo@mail.com') {
        otp = '9999';
      } else {
        otp = this.generateOtp(otpLength);
      }

      // Resolve app config (if needed for email)
      const { cn_str, dbName } = await this.registerLoginService.resolveAppConfig(appName);

      // Get SMTP config from DB
      const conn = await this.registerLoginService.getConnection(cn_str, dbName);
      const db = conn.useDb(dbName);
      const smtpCollection = db.collection('smtp');
      const smtp = await smtpCollection.findOne({});

      let mailOptions: any;
      if (smtp?.sectionData?.smtpConfig) {
        const smtpConfig = smtp.sectionData.smtpConfig;
        mailOptions = {
          from: `"${smtpConfig.name || ''}" <${smtpConfig.email || process.env.EMAIL_USER}>`,
          to: uniqueId,
          subject: smtpConfig.sub || `${appName} OTP Verification`,
          text: `Your OTP is ${otp}. It is valid for ${expiresInMinutes} minutes.`,
        };
      } else {
        mailOptions = {
          from: process.env.EMAIL_USER,
          to: uniqueId,
          subject: `${appName} OTP Verification`,
          text: `Your OTP is ${otp}. It is valid for ${expiresInMinutes} minutes.`,
        };
      }

      // Send email
      await this.emailService.sendOtpEmail(uniqueId, otp);

      // Store OTP in Redis
      const redisKey = `${appName}:otp:${uniqueId}`;
      await this.redisClient.set(redisKey, otp, { EX: expiresInMinutes * 60 });

      return { success: true, message: `OTP sent to ${uniqueId}` };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async verifyOtp(uniqueId: string, otp: string, appName: string) {
    try {
      const redisKey = `${appName}:otp:${uniqueId}`;
      const storedOtp = await this.redisClient.get(redisKey);

      if (!storedOtp) {
        throw new BadRequestException('OTP has expired or not found');
      }
      if (storedOtp !== otp) {
        throw new BadRequestException('Invalid OTP');
      }

      // Delete OTP after verification
      await this.redisClient.del(redisKey);

      return { success: true, message: 'OTP verified successfully' };
    } catch (err: any) {
      if (err.status === 400) throw err;
      throw new InternalServerErrorException(err.message);
    }
  }
}
