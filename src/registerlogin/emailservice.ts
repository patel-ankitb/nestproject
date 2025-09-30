// ===== EmailService =====
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, // smtp.gmail.com
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // must be false for 587 (true only if using port 465)
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendOtpEmail(to: string, otp: string) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || `"No Reply" <${process.env.SMTP_USER}>`,
        to,
        subject: 'Your OTP Code',
        text: `Your OTP is: ${otp}. It will expire in 5 minutes.`,
      };

      const info = await this.transporter.sendMail(mailOptions);

      return {
        success: true,
        message: 'OTP sent to email',
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('Error sending OTP email:', error);
      return {
        success: false,
        message: 'Failed to send OTP email',
        error: error.message,
      };
    }
  }
}
