import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import mongoose, { Connection } from 'mongoose';
import { createClient } from 'redis';
import { SMSService } from './smsservicce';
import { EmailService } from './emailservice';

// Shared Redis client for OTP storage (typed as any to avoid strict type issues in this snippet)
const redisClient: any = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch((err: any) => {
  // Log connection errors; service methods will handle Redis being unavailable at runtime
  console.error('Failed to connect to Redis:', err?.message || err);
});

interface AppConfigType {
  _id: any;
  appnm: string;
  info: { cn_str: string; db: string };
}

@Injectable()
export class RegisterLoginService {
  private connections: Map<string, Connection> = new Map();

  private async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) return this.connections.get(cacheKey)!;
    try {
      const conn = await mongoose.createConnection(cn_str, { dbName }).asPromise();
      this.connections.set(cacheKey, conn);
      return conn;
    } catch (err: any) {
      throw new BadRequestException(`Failed to connect: ${err.message}`);
    }
  }

  private async resolveAppConfig(appName: string): Promise<{ cn_str: string; dbName: string }> {
    const baseUri = process.env.MONGO_URI;
    if (!baseUri) throw new Error('MONGO_URI not defined');

    const centralConn = await this.getConnection(baseUri, 'customize');
    const AppConfigSchema = new mongoose.Schema(
      { appnm: String, info: { cn_str: String, db: String } },
      { strict: false },
    );

    const AppConfig =
      centralConn.models['custom_apps'] ||
      centralConn.model('custom_apps', AppConfigSchema, 'custom_apps');
    const config = (await AppConfig.findOne({ appnm: appName }).lean()) as AppConfigType | null;

    if (!config || !config.info?.cn_str || !config.info?.db) {
      throw new BadRequestException(`App config not found for ${appName}`);
    }
    return { cn_str: config.info.cn_str, dbName: config.info.db };
  }

  private generateTokens(userId: string, roleId: string, tokenVersion = 1) {
    const accessToken = jwt.sign(
      { userId, roleId },
      process.env.JWT_ACCESS_SECRET || 'accesssecret',
      { expiresIn: '1h' },
    );
    const refreshToken = jwt.sign(
      { userId, roleId, tokenVersion },
      process.env.JWT_REFRESH_SECRET || 'refreshsecret',
      { expiresIn: '7d' },
    );
    return { accessToken, refreshToken };
  }

  // Compatibility wrappers so existing calls to createAccessToken/createRefreshToken compile
  private createAccessToken(payload: { userId: string; roleId: string }): string {
    const tokens = this.generateTokens(payload.userId, payload.roleId);
    return tokens.accessToken;
  }

  private createRefreshToken(payload: { userId: string; roleId: string; tokenVersion?: number }): string {
    const tokens = this.generateTokens(payload.userId, payload.roleId, payload.tokenVersion ?? 1);
    return tokens.refreshToken;
  }

  private async sendOtp(dest: string, length = 4, type = 2, appName?: string): Promise<void> {
    try {
      // generate numeric OTP of requested length
      const otp =
        dest === 'hanademo@mail.com'
          ? '9999'
          : Math.floor(Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1)).toString();

      // store OTP in Redis (5 minutes)
      const redisKey = `${appName}:otp:${dest}`;
      await redisClient.set(redisKey, otp, 'EX', 5 * 60);

      // if destination looks like an email, send via EmailService; otherwise keep OTP in Redis for SMS flow to pick up
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest);
      if (isEmail) {
        const emailService = new EmailService();
        await emailService.sendOtpEmail(dest.toLowerCase(), otp);
      } else {
        // For non-email destinations (mobile), we only persist the OTP in Redis here.
        // The SMS sending flow elsewhere can use the stored OTP or use SMSService with additional context.
      }
    } catch (err: any) {
      throw new InternalServerErrorException(err?.message || 'Failed to send OTP');
    }
  }

  // ===== SIGNUP =====
async signupUser(dto: any) {
  const { appName, name, email, password, role, mobile = "", type } = dto;

  if (!appName || !email || (!password && !["otp", "oauth"].includes(type)) || !role) {
    throw new BadRequestException(
      "appName, email, password (unless OTP or OAuth), and role are required"
    );
  }

  try {
    const { cn_str, dbName } = await this.resolveAppConfig(appName);
    const conn = await this.getConnection(cn_str, dbName);
    const db = conn.useDb(dbName);

    const usersCollection = db.collection<any>("appuser");
    const rolesCollection = db.collection<any>("approle");
    const logsCollection = db.collection<any>("login_logs");

    // Check if user exists
    const existingUser = await usersCollection.findOne({
      $or: [
        { "sectionData.appuser.name": email.toLowerCase() },
        { "sectionData.appuser.email": email.toLowerCase() },
      ],
    });

    if (existingUser) {
      throw new BadRequestException("User with this email already exists");
    }

    // Check role
    const assignedRole = await rolesCollection.findOne({ _id: role });
    if (!assignedRole) {
      throw new NotFoundException("Provided role not found");
    }

    const hashedPassword =
      password && !["otp", "oauth"].includes(type)
        ? await bcrypt.hash(password, 10)
        : "";

    const newUser: any = {
      _id: Date.now().toString(),
      sectionData: {
        appuser: {
          name: email.toLowerCase(),
          legalname: name,
          email: email.toLowerCase(),
          mobile,
          role: assignedRole._id,
          password: hashedPassword,
        },
      },
    };

    // Add extra fields dynamically
    for (const field in dto) {
      if (!["appName", "email", "password", "role", "mobile", "name", "type"].includes(field)) {
        newUser.sectionData.appuser[field] = dto[field];
      }
    }

    await usersCollection.insertOne(newUser);

    // ===== OTP FLOW =====
    if (type === "otp") {
      await this.sendOtp(email.toLowerCase(), 4, 2, appName);
      return {
        success: true,
        message: "Signup successful, OTP required",
      };
    }

    // ===== LOG LOGIN =====
    await logsCollection.insertOne({
      _id: Date.now().toString(),
      u_id: newUser._id,
      r_id: assignedRole._id,
      tokenVersion: 1,
      logs: [{ type: "in", time: new Date() }],
    });

    // ===== TOKENS =====
    const accessToken = this.createAccessToken({ userId: newUser._id, roleId: assignedRole._id });
    const refreshToken = this.createRefreshToken({
      userId: newUser._id,
      roleId: assignedRole._id,
      tokenVersion: 1,
    });

    return {
      success: true,
      message: "Signup successful",
      accessToken,
      refreshToken,
      user: {
        _id: newUser._id,
        username: newUser.sectionData.appuser.name,
        role: assignedRole.sectionData.approle,
      },
    };
  } catch (error: any) {
    throw new InternalServerErrorException(error.message);
  }
}

// // ===== LOGIN =====
async loginUser(dto: any) {
  const { appName, name, type } = dto;

  if (!appName) throw new BadRequestException('appName is required');
  if (type === 'otp' && !name)
    throw new BadRequestException('Name (mobile/email) is required for OTP login');

  try {
    const { cn_str, dbName } = await this.resolveAppConfig(appName);
    const conn = await this.getConnection(cn_str, dbName);
    const db = conn.useDb(dbName);

    const usersCollection = db.collection<any>('appuser');
    const rolesCollection = db.collection<any>('approle');

    let user;

    // ===== OTP LOGIN =====
    if (type === 'otp') {
      // Detect if 'name' is email or mobile
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name);

      if (isEmail) {
        user = await usersCollection.findOne({
          'sectionData.appuser.email': name.toLowerCase(),
        });
      } else {
        user = await usersCollection.findOne({
          'sectionData.appuser.mobile': name,
        });
      }

      if (!user) throw new NotFoundException('User not found');

      const role = await rolesCollection.findOne({
        _id: user.sectionData.appuser.role,
      });
      if (!role) throw new NotFoundException('Role not found');

      // ===== Generate OTP =====
      let otp: string;
      if (name === 'hanademo@mail.com') {
        otp = '9999'; // fixed OTP for demo user
      } else {
        otp = Math.floor(1000 + Math.random() * 9000).toString();
      }

      // ===== Save OTP in Redis (expires in 5 min) =====
      const redisKey = `${appName}:otp:${name}`;
      await redisClient.set(redisKey, otp, 'EX', 5 * 60);

      // ===== Send OTP via SMS or Email =====
      if (!isEmail) {
        // Mobile → SMS
        const smsService = new SMSService();
        const smsConfigDoc = await db.collection('sms').findOne({});
        if (!smsConfigDoc?.sectionData?.sms)
          throw new InternalServerErrorException('SMS configuration not found');
        const smsConfigId = smsConfigDoc._id.toString();

        await smsService.sendMessage(
          appName,
          cn_str,
          dbName,
          smsConfigId,
          user.sectionData.appuser.mobile,
          otp,
          'otp',
        );
      } else {
        // Email → SMTP
        const emailService = new EmailService();
        await emailService.sendOtpEmail(user.sectionData.appuser.email, otp);
      }

      return {
        success: true,
        message: 'OTP sent successfully',
        userId: user._id.toString(),
      };
    }

    // ===== Password login (optional) =====
    throw new BadRequestException('Password login not implemented in this snippet');
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}



// ===== VERIFY OTP =====
async verifyOtp(dto: any) {
  const { appName, email, name, otp } = dto;
  if (!appName || (!email && !name) || !otp) {
    throw new BadRequestException('appName, email/name, and otp are required');
  }

  try {
    const uniqueId = email || name;

    const { cn_str, dbName } = await this.resolveAppConfig(appName);
    const conn = await this.getConnection(cn_str, dbName);
    const db = conn.useDb(dbName);

    const usersCollection = db.collection<any>('appuser');
    const rolesCollection = db.collection<any>('approle');

    const orFilters: any[] = [];
    if (email) orFilters.push({ 'sectionData.appuser.email': email.toLowerCase() });
    if (name) orFilters.push({ 'sectionData.appuser.mobile': name });

    const user = await usersCollection.findOne({ $or: orFilters });
    if (!user) throw new NotFoundException('User not found');

    const role = await rolesCollection.findOne({ _id: user.sectionData.appuser.role });
    if (!role) throw new NotFoundException('Role not found');

    // ===== Verify OTP from Redis =====
    const redisKey = `${appName}:otp:${uniqueId}`;
    const storedOtp = await redisClient.get(redisKey);

    if (!storedOtp) throw new UnauthorizedException('OTP expired or not found');
    if (storedOtp !== otp) throw new UnauthorizedException('Invalid OTP');

    // Delete OTP after successful verification
    await redisClient.del(redisKey);

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(
      user._id.toString(),
      role._id.toString(),
    );

    return {
      success: true,
      message: 'OTP verified successfully',
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        name: user.sectionData.appuser.name,
        mobile: user.sectionData.appuser.mobile,
        legalname: user.sectionData.appuser.legalname,
        email: user.sectionData.appuser.email,
        panNumber: user.sectionData.appuser.panNumber,
        role: role.sectionData?.approle || {
          name: 'Default',
          permissions: [],
        },
      },
    };
  } catch (err: any) {
    throw new InternalServerErrorException(err.message);
  }
}



// ===== MOBILE OTP LOGIN (USER MAY NOT EXIST) =====
// async mobileOtpLogin(dto: any) {
//   const { appName, name } = dto;
//   if (!appName || !name) {
//     throw new BadRequestException('appName and name are required');
//   }

//   try {
//     const { cn_str, dbName } = await this.resolveAppConfig(appName);
//     const conn = await this.getConnection(cn_str, dbName);
//     const db = conn.useDb(dbName);

//     const usersCollection = db.collection<any>('appuser');
//     const otpLogsCollection = db.collection<any>('otp_logs');
//     const smsCollection = db.collection<any>('sms');

//     // Check if user exists
//     let user = await usersCollection.findOne({
//       'sectionData.appuser.mobile': name,
//     });

//     // Generate string userId
//     let userId = user ? user._id.toString() : Date.now().toString();

//     // If user does not exist, create temporary user with string _id
//     if (!user) {
//       user = {
//         _id: userId,
//         sectionData: {
//           appuser: {
//             name,
//             mobile: name,
//             panNumber: '',
//             legalname: '',
//             email: '',
//             role: '',
//             password: '',
//           },
//         },
//       };
//       await usersCollection.insertOne(user);
//     }

//     // Generate 4-digit OTP
//     const otp = Math.floor(1000 + Math.random() * 9000).toString();

//     // Save OTP log with string IDs
//     await otpLogsCollection.insertOne({
//       _id: Date.now().toString(),
//       userId,
//       otp,
//       createdAt: new Date(),
//       expiresAt: new Date(Date.now() + 5 * 60 * 1000),
//       used: false,
//     });

    // Send OTP via SMS
//     const smsService = new SMSService();
//     const smsConfigDoc = await smsCollection.findOne({});
//     if (!smsConfigDoc?.sectionData?.sms) {
//       throw new InternalServerErrorException('SMS configuration not found');
//     }
//     const smsConfigId = smsConfigDoc._id.toString();

//     await smsService.sendMessage(
//       appName,
//       cn_str,
//       dbName,
//       smsConfigId,
//       user.sectionData.appuser.mobile,
//       otp,
//       'otp',
//     );

//     return {
//       success: true,
//       message: 'OTP sent successfully',
//       userId, // string
//     };
//   } catch (err: any) {
//     throw new InternalServerErrorException(err.message);
//   }
// }


}