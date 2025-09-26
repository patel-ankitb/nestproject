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
    this.config = config;
  }

  async sendSMS(to: string, message: string, type: 'msg' | 'otp' = 'msg') {
    try {
      if (process.env.NODE_ENV === 'development') {
        const otp = type === 'otp' ? generateRandomOTP() : null;
        console.log(`[DEV MODE] SMS to ${to} →`, type === 'otp' ? `OTP: ${otp}` : message);
        return { success: true, messageId: 'mock-dev', otp };
      }

      if (type === 'otp') {
        const otp = message || generateRandomOTP();
        const queryParams = new URLSearchParams({
          template_id: this.config.templateId,
          mobile: to,
          authkey: this.config.authKey,
          otp,
          otp_expiry: '5',
          realTimeResponse: '1',
        }).toString();

        const response = await axios.post(
          `${this.config.baseUrl}otp?${queryParams}`,
          {},
          { headers: { authkey: this.config.authKey, 'content-type': 'application/json' } },
        );
        console.log('MSG91 OTP response:', response.data);
        console.log('MSG91 OTP sent to:',  `${this.config.baseUrl}otp?${queryParams}`);

        if (response.data.type === 'success') {
          return { success: true, messageId: response.data.request_id, otp };
        }
        throw new Error(response.data.message || 'MSG91 OTP error');
      } else {
        const payload = {
          template_id: this.config.templateId,
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
      throw new InternalServerErrorException(`MSG91 send error: ${err.message}`);
    }
  }

  async verifyOTP(to: string, otp: string) {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV MODE] Verify OTP ${otp} for ${to}`);
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
    this.config = config;
  }

  async sendSMS(to: string, message: string) {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV MODE] Twilio SMS to ${to}: ${message}`);
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
    type: 'msg' | 'otp',
  ) {
    try {
      const appDb = await getAppDB(cn_str, dbName);
      const configDoc = await appDb.collection('sms').findOne({ _id: id as any });
      if (!configDoc?.sectionData?.sms) {
        throw new InternalServerErrorException('SMS configuration not found');
      }

      const smsConfig = configDoc.sectionData.sms;

      // ✅ Select correct provider config
      let providerConfig: any;
      if (smsConfig.smsProvider?.toLowerCase() === 'msg91') {
        providerConfig = {
          ...smsConfig.msg91,
          smsProvider: 'msg91',
          type: smsConfig.type,
        };
      } else if (smsConfig.smsProvider?.toLowerCase() === 'twilio') {
        providerConfig = {
          ...smsConfig.twilio,
          smsProvider: 'twilio',
          type: smsConfig.type,
        };
      } else {
        throw new InternalServerErrorException(
          `Unsupported SMS provider: ${smsConfig.smsProvider}`,
        );
      }

      const provider = SMSFactory.getProvider(providerConfig);
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

      const smsConfig = configDoc.sectionData.sms;

      // ✅ Select correct provider config
      let providerConfig: any;
      if (smsConfig.smsProvider?.toLowerCase() === 'msg91') {
        providerConfig = {
          ...smsConfig.msg91,
          smsProvider: 'msg91',
          type: smsConfig.type,
        };
      } else if (smsConfig.smsProvider?.toLowerCase() === 'twilio') {
        providerConfig = {
          ...smsConfig.twilio,
          smsProvider: 'twilio',
          type: smsConfig.type,
        };
      } else {
        throw new InternalServerErrorException(
          `Unsupported SMS provider: ${smsConfig.smsProvider}`,
        );
      }

      const provider = SMSFactory.getProvider(providerConfig);
      return await provider.verifyOTP(to, otp);
    } catch (err: any) {
      throw new InternalServerErrorException(`verifyOTP failed: ${err.message}`);
    }
  }
}

