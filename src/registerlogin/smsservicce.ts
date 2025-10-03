// import { Injectable, InternalServerErrorException } from '@nestjs/common';
// import axios from 'axios';
// import Twilio from 'twilio';
// import { MongoClient, Db } from 'mongodb';

// // ===== Helper to get App DB =====
// async function getAppDB(cn_str: string, dbName: string): Promise<Db> {
//   try {
//     const client = new MongoClient(cn_str);
//     await client.connect();
//     return client.db(dbName);
//   } catch (err: any) {
//     throw new InternalServerErrorException(`DB connection failed: ${err.message}`);
//   }
// }

// // ===== Base SMS Provider =====
// abstract class SMSProvider {
//   abstract sendSMS(
//     to: string,
//     message: string,
//     type?: 'msg' | 'otp',
//     params?: any,
//   ): Promise<any>;
//   abstract verifyOTP(to: string, otp: string, params?: any): Promise<any>;
// }

// // ===== Helper to generate OTP =====
// function generateRandomOTP(length = 4) {
//   return Math.floor(Math.random() * Math.pow(10, length))
//     .toString()
//     .padStart(length, '0');
// }

// // ===== Phone number validator =====
// function validatePhoneNumber(to: string) {
//   if (!to || !to.trim()) throw new InternalServerErrorException('Recipient phone number is required');
//   const phoneRegex = /^\+[1-9]\d{6,14}$/; // E.164 format
//   if (!phoneRegex.test(to)) {
//     throw new InternalServerErrorException(
//       `Invalid phone number format: "${to}". Use E.164 format (e.g., +14155552671).`,
//     );
//   }
// }

// // ===== MSG91 Provider =====
// class MSG91Provider extends SMSProvider {
//   private config: any;
//   constructor(config: any) {
//     super();
//     this.config = config;
//   }

//   async sendSMS(to: string, message: string, type: 'msg' | 'otp' = 'msg') {
//     validatePhoneNumber(to);

//     if (process.env.NODE_ENV === 'development') {
//       const otp = type === 'otp' ? generateRandomOTP() : null;
//       console.log(`[DEV MODE] MSG91 SMS to ${to} →`, type === 'otp' ? `OTP: ${otp}` : message);
//       return { success: true, messageId: 'mock-dev', otp };
//     }

//     if (type === 'otp') {
//       const otp = generateRandomOTP();
//       const queryParams = new URLSearchParams({
//         template_id: this.config.templateId,
//         mobile: to,
//         authkey: this.config.authKey,
//         otp,
//         otp_expiry: '5',
//         realTimeResponse: '1',
//       }).toString();

//       const response = await axios.post(
//         `${this.config.baseUrl}otp?${queryParams}`,
//         {},
//         { headers: { authkey: this.config.authKey, 'content-type': 'application/json' } },
//       );

//       if (response.data.type === 'success') return { success: true, messageId: response.data.request_id, otp };
//       throw new Error(response.data.message || 'MSG91 OTP error');
//     } else {
//       const payload = { template_id: this.config.templateId, recipients: [{ mobiles: to, message }] };
//       const response = await axios.post(`${this.config.baseUrl}flow/`, payload, {
//         headers: { authkey: this.config.authKey, 'content-type': 'application/json' },
//       });

//       if (response.data.type === 'success') return { success: true, messageId: response.data.request_id };
//       throw new Error(response.data.message || 'MSG91 MSG error');
//     }
//   }

//   async verifyOTP(to: string, otp: string) {
//     validatePhoneNumber(to);
//     if (!otp || !otp.trim()) throw new InternalServerErrorException('OTP is required');

//     if (process.env.NODE_ENV === 'development') {
//       console.log(`[DEV MODE] Verify OTP ${otp} for ${to}`);
//       return { success: true, message: 'OTP verified (mock)' };
//     }

//     const queryParams = new URLSearchParams({
//       authkey: this.config.authKey,
//       mobile: to,
//       otp,
//     }).toString();

//     const response = await axios.get(`${this.config.baseUrl}otp/verify?${queryParams}`, {
//       headers: { authkey: this.config.authKey, 'content-type': 'application/json' },
//     });

//     if (response.data.type === 'success') return { success: true, message: 'OTP verified successfully' };
//     throw new Error(response.data.message || 'MSG91 OTP verification error');
//   }
// }

// // ===== Twilio Provider =====
// class TwilioProvider extends SMSProvider {
//   private config: any;
//   constructor(config: any) {
//     super();
//     this.config = config;
//   }

//   async sendSMS(to: string, message: string, type: 'msg' | 'otp' = 'msg') {
//     validatePhoneNumber(to);

//     if (process.env.NODE_ENV === 'development') {
//       const otp = type === 'otp' ? generateRandomOTP() : null;
//       console.log(`[DEV MODE] Twilio SMS to ${to} →`, type === 'otp' ? `OTP: ${otp}` : message);
//       return { success: true, messageId: 'mock-dev', otp };
//     }

//     const client = Twilio(this.config.accountSid, this.config.authToken);
//     let body = message;

//     if (type === 'otp') {
//       const otp = generateRandomOTP();
//       body = `Your OTP is: ${otp}`;
//       const response = await client.messages.create({ body, from: this.config.fromNumber, to });
//       return { success: true, messageId: response.sid, otp };
//     }

//     const response = await client.messages.create({ body, from: this.config.fromNumber, to });
//     return { success: true, messageId: response.sid };
//   }

//   async verifyOTP(to: string, otp: string) {
//     validatePhoneNumber(to);
//     if (!otp || !otp.trim()) throw new InternalServerErrorException('OTP is required');

//     if (process.env.NODE_ENV === 'development') {
//       console.log(`[DEV MODE] Mock Twilio OTP verify ${to} → ${otp}`);
//       return { success: true, message: 'OTP verified (mock)' };
//     }

//     throw new InternalServerErrorException('Twilio OTP verification not implemented');
//   }
// }

// // ===== SMS Factory =====
// class SMSFactory {
//   static getProvider(config: any): SMSProvider {
//     switch (config.smsProvider?.toLowerCase()) {
//       case 'msg91':
//         return new MSG91Provider(config);
//       case 'twilio':
//         return new TwilioProvider(config);
//       default:
//         throw new InternalServerErrorException(`Unsupported SMS provider: ${config.smsProvider}`);
//     }
//   }
// }

// // ===== NestJS Injectable SMS Service =====
// @Injectable()
// export class SMSService {
//   // Send SMS / OTP
//   async sendSMSWithProviderConfig(config: any, to: string, message: string, type: 'msg' | 'otp' = 'otp') {
//     const provider = SMSFactory.getProvider(config);
//     return await provider.sendSMS(to, message, type);
//   }

//   // Fetch SMS config automatically and send SMS
//   async sendSMS(dbConn: Db, to: string, message: string, type: 'msg' | 'otp' = 'otp') {
//     try {
//       const smsDoc = await dbConn.collection('sms').findOne({});
//       if (!smsDoc?.sectionData?.sms) throw new InternalServerErrorException('SMS configuration not found');

//       const smsSection = smsDoc.sectionData.sms;
//       let providerConfig: any;

//       if (smsSection.smsProvider?.toLowerCase() === 'msg91') providerConfig = { ...smsSection.msg91, smsProvider: 'msg91' };
//       else if (smsSection.smsProvider?.toLowerCase() === 'twilio') providerConfig = { ...smsSection.twilio, smsProvider: 'twilio' };
//       else throw new InternalServerErrorException('Unsupported SMS provider');

//       return await this.sendSMSWithProviderConfig(providerConfig, to, message, type);
//     } catch (err: any) {
//       throw new InternalServerErrorException(`sendSMS failed: ${err.message}`);
//     }
//   }

//   // Verify OTP
//   async verifySMSOTP(dbConn: Db, to: string, otp: string) {
//     try {
//       const smsDoc = await dbConn.collection('sms').findOne({});
//       if (!smsDoc?.sectionData?.sms) throw new InternalServerErrorException('SMS configuration not found');

//       const smsSection = smsDoc.sectionData.sms;
//       let providerConfig: any;

//       if (smsSection.smsProvider?.toLowerCase() === 'msg91') providerConfig = { ...smsSection.msg91, smsProvider: 'msg91' };
//       else if (smsSection.smsProvider?.toLowerCase() === 'twilio') providerConfig = { ...smsSection.twilio, smsProvider: 'twilio' };
//       else throw new InternalServerErrorException('Unsupported SMS provider');

//       const provider = SMSFactory.getProvider(providerConfig);
//       return await provider.verifyOTP(to, otp);
//     } catch (err: any) {
//       throw new InternalServerErrorException(`verifySMSOTP failed: ${err.message}`);
//     }
//   }
// }
