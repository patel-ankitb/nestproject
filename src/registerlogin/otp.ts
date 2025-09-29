// import { Injectable } from '@nestjs/common';
// import { InjectRedis, Redis } from '@nestjs-modules/ioredis';
// import * as crypto from 'crypto';
// import { EmailService } from './email.service'; // Assuming an EmailService exists
// import { AppDatabaseService } from './app-database.service'; // Service for DB connection
// import { SMSService } from './sms.service'; // SMS service for sending OTP via SMS
// import { RegisterLoginService } from './registerlogin.service'; // Service for app config resolution

// @Injectable()
// export class OtpService {
//   constructor(
//     @InjectRedis() private readonly redisClient: Redis,
//     private readonly emailService: EmailService,
//     private readonly appDatabaseService: AppDatabaseService,
//     private readonly smsService: SMSService,
//     private readonly registerLoginService: RegisterLoginService,
//   ) {}

//   private generateOtp(length: number = 6): string {
//     return crypto
//       .randomInt(Math.pow(10, length - 1), Math.pow(10, length))
//       .toString();
//   }

//   async sendOtp(
//     uniqueId: string,
//     otpLength: number = 6,
//     expiresInMinutes: number = 2,
//     appName: string,
//     type: number = 2, // 1 for SMS, 2 for Email
//   ): Promise<{ success: boolean; message: string }> {
//     let otp: string;

//     // Check if the username matches 'hanademo@mail.com' and set OTP to 9999
//     if (uniqueId === 'hanademo@mail.com') {
//       otp = '9999'; // Fixed OTP
//     } else {
//       otp = this.generateOtp(otpLength); // Generate OTP for other users
//     }

//     // Get database connection and app configuration
//     const { connectionString, dbName } =
//       await this.registerLoginService.resolveAppConfig(appName);
//     const appDb = await this.appDatabaseService.getConnection(
//       connectionString,
//       dbName,
//     );

//     if (type === 2) {
//       // Email OTP
//       const smtpCollection = appDb.collection('smtp');
//       const smtp = await smtpCollection.findOne({});

//       let mailOptions: {
//         from: string;
//         to: string;
//         subject: string;
//         text: string;
//       };

//       if (smtp && smtp.sectionData && smtp.sectionData.smtpConfig) {
//         const smtpConfig = sms.sectionData.smtpConfig;
//         const fromName = smtpConfig.name || '';
//         const fromEmail = smtpConfig.email || process.env.EMAIL_USER;
//         const fromSubject = smtpConfig.sub || `${appName} OTP Verification`;

//         mailOptions = {
//           from: `"${fromName}" <${fromEmail}>`,
//           to: uniqueId,
//           subject: fromSubject,
//           text: `Your OTP is ${otp}. It is valid for ${expiresInMinutes} minutes.`,
//         };
//       } else {
//         mailOptions = {
//           from: process.env.EMAIL_USER,
//           to: uniqueId,
//           subject: `${appName} OTP Verification`,
//           text: `Your OTP is ${otp}. It is valid for ${expiresInMinutes} minutes.`,
//         };
//       }

//       await this.emailService.sendEmail(mailOptions);
//     } else if (type === 1) {
//       // SMS OTP
//       const smsCollection = appDb.collection('sms');
//       const smsConfig = await smsCollection.findOne({});

//       if (!smsConfig) {
//         throw new Error('SMS configuration not found');
//       }

//       await this.smsService.sendMessage(
//         appName,
//         connectionString,
//         dbName,
//         smsConfig._id.toString(),
//         uniqueId, // Assuming uniqueId is a phone number for SMS
//         otp,
//         'otp',
//       );
//     } else {
//       throw new Error('Invalid OTP delivery type');
//     }

//     // Store OTP in Redis
//     const redisKey = `${appName}:otp:${uniqueId}`;
//     await this.redisClient.set(redisKey, otp, 'EX', expiresInMinutes * 60);

//     return { success: true, message: `OTP sent to ${uniqueId} via ${type === 1 ? 'SMS' : 'Email'}` };
//   }

//   async verifyOtp(
//     uniqueId: string,
//     otp: string,
//     appName: string,
//   ): Promise<{ success: boolean; message: string }> {
//     const redisKey = `${appName}:otp:${uniqueId}`;
//     const storedOtp = await this.redisClient.get(redisKey);

//     if (!storedOtp) {
//       return { success: false, message: 'OTP has expired or not found' };
//     }

//     if (storedOtp !== otp) {
//       return { success: false, message: 'Invalid OTP' };
//     }

//     return { success: true, message: 'OTP verified successfully' };
//   }
// }