// ===== EmailService =====
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, // e.g. smtp.gmail.com
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465, // only true for 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendOtpEmail(to: string, otp: string) {
    try {
      if (!to || !to.trim()) {
        throw new InternalServerErrorException('Recipient email is required');
      }

      // basic email regex
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(to)) {
        throw new InternalServerErrorException(`Invalid recipient email: "${to}"`);
      }

      const mailOptions = {
        from: process.env.SMTP_FROM || `"No Reply" <${process.env.SMTP_USER}>`,
        to,
        subject: 'Your OTP Code',
        text: `Your OTP is: ${otp}. It will expire in 5 minutes.`,
      };

      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV MODE] Email → ${to}, OTP: ${otp}`);
        return {
          success: true,
          message: 'OTP email simulated (DEV mode)',
          messageId: 'mock-dev',
        };
      }

      const info = await this.transporter.sendMail(mailOptions);

      return {
        success: true,
        message: 'OTP sent to email',
        messageId: info.messageId,
      };
    } catch (error: any) {
      console.error('Error sending OTP email:', error);
      throw new InternalServerErrorException(
        `Failed to send OTP email: ${error.message}`,
      );
    }
  }
}
