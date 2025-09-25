import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import Twilio from 'twilio';
import { MongoClient, Db } from 'mongodb';

interface AppConfig {
  cn_str: string;
  db: string;
}

// ===== Helper to get App DB =====
async function getAppDB(cn_str: string, dbName: string): Promise<Db> {
  try {
    const client = new MongoClient(cn_str);
    await client.connect();
    return client.db(dbName);
  } catch (err: any) {
    throw new InternalServerErrorException(`DB connection failed: ${err.message}`);
  }
}

// ===== Base SMS Provider =====
abstract class SMSProvider {
  abstract sendSMS(
    to: string,
    message: string,
    type?: 'msg' | 'otp',
    params?: any,
  ): Promise<any>;
  abstract verifyOTP(to: string, otp: string, params?: any): Promise<any>;
}

// ===== Helper to generate OTP =====
function generateRandomOTP(length = 4) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, '0');
}

// ===== MSG91 Provider =====
class MSG91Provider extends SMSProvider {
  private config: any;
  constructor(config: any) {
    super();
    this.config = config.msg91;
  }

  async sendSMS(to: string, message: string, type: 'msg' | 'otp' = 'msg') {
    try {
      if (process.env.NODE_ENV === 'development') {
        const otp = type === 'otp' ? generateRandomOTP() : null;
        console.log(
          `[DEV MODE] Mock SMS sent to ${to} →`,
          type === 'otp' ? `OTP: ${otp}` : message,
        );
        return { success: true, messageId: 'mock-dev', otp };
      }

      if (type === 'otp') {
        const otp = /^\d{4,6}$/.test(message) ? message : generateRandomOTP();
        const payload = { otp };
        const queryParams = new URLSearchParams({
          template_id: this.config.templateId,
          mobile: to,
          authkey: this.config.authKey,
          otp_expiry: '5',
          realTimeResponse: '1',
        }).toString();

        const response = await axios.post(
          `${this.config.baseUrl}otp?${queryParams}`,
          payload,
          { headers: { authkey: this.config.authKey, 'content-type': 'application/json' } },
        );

        if (response.data.type === 'success') {
          return { success: true, messageId: response.data.request_id, otp };
        }
        throw new Error(response.data.message || 'MSG91 OTP error');
      } else {
        const payload = {
          template_id: this.config.templateId,
          realTimeResponse: 1,
          recipients: [{ mobiles: to, message }],
        };
        const response = await axios.post(`${this.config.baseUrl}flow/`, payload, {
          headers: { authkey: this.config.authKey, 'content-type': 'application/json' },
        });
        if (response.data.type === 'success') {
          return { success: true, messageId: response.data.request_id };
        }
        throw new Error(response.data.message || 'MSG91 MSG error');
      }
    } catch (err: any) {
      if (err.message?.includes('IP is not whitelisted')) {
        // Fallback to mock OTP if IP not whitelisted
        const otp = type === 'otp' ? generateRandomOTP() : null;
        console.warn(
          `[MSG91] IP not whitelisted. Using fallback mock OTP for ${to}: ${otp}`,
        );
        return { success: true, messageId: 'mock-fallback', otp };
      }
      throw new InternalServerErrorException(`MSG91 send error: ${err.message}`);
    }
  }

  async verifyOTP(to: string, otp: string) {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV MODE] Mock OTP verification for ${to} → OTP: ${otp}`);
        return { success: true, message: 'OTP verified (mock)' };
      }

      const queryParams = new URLSearchParams({
        authkey: this.config.authKey,
        mobile: to,
        otp,
      }).toString();

      const response = await axios.get(`${this.config.baseUrl}otp/verify?${queryParams}`, {
        headers: { authkey: this.config.authKey, 'content-type': 'application/json' },
      });

      if (response.data.type === 'success') {
        return { success: true, message: 'OTP verified successfully' };
      }
      throw new Error(response.data.message || 'MSG91 OTP verification error');
    } catch (err: any) {
      throw new InternalServerErrorException(`MSG91 verify error: ${err.message}`);
    }
  }
}

// ===== Twilio Provider =====
class TwilioProvider extends SMSProvider {
  private config: any;
  constructor(config: any) {
    super();
    this.config = config.twilio;
  }

  async sendSMS(to: string, message: string) {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV MODE] Mock Twilio SMS to ${to}: ${message}`);
        return { success: true, messageId: 'mock-dev' };
      }

      const client = Twilio(this.config.accountSid, this.config.authToken);
      const response = await client.messages.create({
        body: message,
        from: this.config.fromNumber,
        to,
      });
      return { success: true, messageId: response.sid };
    } catch (err: any) {
      throw new InternalServerErrorException(`Twilio send error: ${err.message}`);
    }
  }

  async verifyOTP(to: string, otp: string) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV MODE] Mock Twilio OTP verify ${to} → ${otp}`);
      return { success: true, message: 'OTP verified (mock)' };
    }
    throw new InternalServerErrorException('Twilio OTP verification not implemented');
  }
}

// ===== SMS Factory =====
class SMSFactory {
  static getProvider(config: any): SMSProvider {
    switch (config.smsProvider?.toLowerCase()) {
      case 'msg91':
        return new MSG91Provider(config);
      case 'twilio':
        return new TwilioProvider(config);
      default:
        throw new InternalServerErrorException(
          `Unsupported SMS provider: ${config.smsProvider}`,
        );
    }
  }
}

// ===== NestJS Injectable SMS Service =====
@Injectable()
export class SMSService {
  // Send SMS / OTP
  async sendMessage(
    appName: string,
    cn_str: string,
    dbName: string,
    id: string,
    to: string,
    message: string,
    type: 'msg' | 'otp' = 'msg',
  ) {
    try {
      const appDb = await getAppDB(cn_str, dbName);
      const configDoc = await appDb.collection('sms').findOne({ _id: id as any });
      if (!configDoc?.sectionData?.sms) {
        throw new InternalServerErrorException('SMS configuration not found');
      }

      const config = configDoc.sectionData.sms;
      const provider = SMSFactory.getProvider(config);
      return await provider.sendSMS(to, message, type);
    } catch (err: any) {
      throw new InternalServerErrorException(`sendMessage failed: ${err.message}`);
    }
  }

  // Verify OTP
  async verifyOTP(
    appName: string,
    cn_str: string,
    dbName: string,
    id: string,
    to: string,
    otp: string,
  ) {
    try {
      const appDb = await getAppDB(cn_str, dbName);
      const configDoc = await appDb.collection('sms').findOne({ _id: id as any });
      if (!configDoc?.sectionData?.sms) {
        throw new InternalServerErrorException('SMS configuration not found');
      }

      const config = configDoc.sectionData.sms;
      const provider = SMSFactory.getProvider(config);
      return await provider.verifyOTP(to, otp);
    } catch (err: any) {
      throw new InternalServerErrorException(`verifyOTP failed: ${err.message}`);
    }
  }
}
