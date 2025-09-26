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
import { SMSService } from './smsservicce';
import { EmailService } from './emailservice';

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

  // ===== SIGNUP =====
async signupUser(dto: any) {
  const { appName, legalname, email, password, role, mobile = '', panNumber = '', type } = dto;

  if (!appName || (!email && !mobile) || (!password && !['otp', 'oauth'].includes(type)) || !role) {
    throw new BadRequestException(
      'appName, email/mobile, password (unless OTP/OAuth), role required',
    );
  }

  try {
    const { cn_str, dbName } = await this.resolveAppConfig(appName);
    const conn = await this.getConnection(cn_str, dbName);
    const db = conn.useDb(dbName);

    const usersCollection = db.collection<any>('appuser');
    const rolesCollection = db.collection<any>('approle');
    const logsCollection = db.collection<any>('login_logs');
    const otpLogsCollection = db.collection<any>('otp_logs');

    const orFilters: any[] = [];
    if (email) orFilters.push({ 'sectionData.appuser.email': email.toLowerCase() });
    if (mobile) orFilters.push({ 'sectionData.appuser.mobile': mobile });

    const existingUser = await usersCollection.findOne({ $or: orFilters.length ? orFilters : [{}] });
    if (existingUser) throw new BadRequestException('User with this email/mobile already exists');

    const assignedRole = await rolesCollection.findOne({ _id: role });
    if (!assignedRole) throw new NotFoundException('Provided role not found');

    const hashedPassword =
      password && !['otp', 'oauth'].includes(type) ? await bcrypt.hash(password, 10) : '';

    const newUserId = Date.now().toString();
    const newUser = {
      _id: newUserId,
      sectionData: {
        appuser: {
          name: mobile || '',
          legalname: legalname || '',
          panNumber: panNumber || '',
          mobile: mobile || '',
          email: email ? email.toLowerCase() : '',
          role: assignedRole._id.toString(),
          password: hashedPassword,
        },
      },
    };

    await usersCollection.insertOne(newUser);

    let accessToken = '';
    let refreshToken = '';
    let message = 'Signup successful';

    // ===== OTP FLOW =====
    if (type === 'otp') {
      if (!mobile) throw new BadRequestException('Mobile number is required for OTP signup');

      const smsService = new SMSService();
      const smsConfigDoc = await db.collection('sms').findOne({});
      if (!smsConfigDoc?.sectionData?.sms)
        throw new InternalServerErrorException('SMS configuration not found');

      const smsConfigId = smsConfigDoc._id.toString();
      const otp = Math.floor(1000 + Math.random() * 9000).toString();

      await otpLogsCollection.insertOne({
        _id: Date.now().toString(),
        userId: newUserId,
        otp,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        used: false,
      });

      await smsService.sendMessage(appName, cn_str, dbName, smsConfigId, mobile, otp, 'otp');

      message = 'Signup successful, OTP sent to mobile';
    } else {
      // ===== PASSWORD/OAUTH FLOW =====
      await logsCollection.insertOne({
        _id: Date.now().toString(),
        u_id: newUserId,
        r_id: assignedRole._id.toString(),
        tokenVersion: 1,
        logs: [{ type: 'in', time: new Date() }],
      });

      const tokens = this.generateTokens(newUserId, assignedRole._id.toString());
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    }

    // ===== UNIFIED RESPONSE =====
    return {
      success: true,
      message,
      accessToken: accessToken || undefined,
      refreshToken: refreshToken || undefined,
      user: {
        _id: newUser._id,
        name: newUser.sectionData.appuser.name,
        mobile: newUser.sectionData.appuser.mobile,
        legalname: newUser.sectionData.appuser.legalname,
        email: newUser.sectionData.appuser.email,
        panNumber: newUser.sectionData.appuser.panNumber,
        role: assignedRole.sectionData?.approle || {
          name: 'Default',
          permissions: [],
        },
      },
    };
  } catch (err: any) {
    throw new InternalServerErrorException(err.message);
  }
}

  // // ===== LOGIN =====
  // async loginUser(dto: any) {
  //   const { appName, name, type } = dto;

  //   if (!appName) throw new BadRequestException('appName is required');
  //   if (type === 'otp' && !name)
  //     throw new BadRequestException('Name (mobile/email) is required for OTP login');

  //   try {
  //     const { cn_str, dbName } = await this.resolveAppConfig(appName);
  //     const conn = await this.getConnection(cn_str, dbName);
  //     const db = conn.useDb(dbName);

  //     const usersCollection = db.collection<any>('appuser');
  //     const rolesCollection = db.collection<any>('approle');
  //     const otpLogsCollection = db.collection<any>('otp_logs');

  //     let user;

  //     // ===== OTP LOGIN =====
  //     if (type === 'otp') {
  //       // Detect if 'name' is email or mobile
  //       const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name);

  //       if (isEmail) {
  //         user = await usersCollection.findOne({
  //           'sectionData.appuser.email': name.toLowerCase(),
  //         });
  //       } else {
  //         user = await usersCollection.findOne({
  //           'sectionData.appuser.mobile': name,
  //         });
  //       }

  //       if (!user) throw new NotFoundException('User not found');

  //       const role = await rolesCollection.findOne({
  //         _id: user.sectionData.appuser.role,
  //       });
  //       if (!role) throw new NotFoundException('Role not found');

  //       // Generate OTP
  //       const otp = Math.floor(1000 + Math.random() * 9000).toString();

  //       // Save OTP log with string IDs
  //       await otpLogsCollection.insertOne({
  //         _id: Date.now().toString(),
  //         userId: user._id.toString(),
  //         otp,
  //         createdAt: new Date(),
  //         expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  //         used: false,
  //       });

  //       // Send OTP via SMS or Email
  //       if (!isEmail) {
  //         // Mobile → SMS
  //         const smsService = new SMSService();
  //         const smsConfigDoc = await db.collection('sms').findOne({});
  //         if (!smsConfigDoc?.sectionData?.sms)
  //           throw new InternalServerErrorException('SMS configuration not found');
  //         const smsConfigId = smsConfigDoc._id.toString();

  //       const send =   await smsService.sendMessage(
  //           appName,
  //           cn_str,
  //           dbName,
  //           smsConfigId,
  //           user.sectionData.appuser.mobile,
  //           otp,
  //           'otp',
  //         );
          
  //         console.log('User OTP login successful:', send);
  //       } else {
  //         // Email → SMTP
  //         const emailService = new EmailService();

  //         const usere = await emailService.sendOtpEmail(user.sectionData.appuser.email, otp);

  //       }
  //       return {
  //         success: true,
  //         message: 'OTP sent successfully',
  //         userId: user._id.toString(), // only string
  //       };
  //     }

  //     // ===== Password login (optional) =====
  //     throw new BadRequestException('Password login not implemented in this snippet');
  //   } catch (err: any) {
  //     return { success: false, message: err.message };
  //   }
  // }



  // ===== VERIFY OTP =====
  async verifyOtp(dto: any) {
    const { appName, email, name, otp } = dto;
    if (!appName || (!email && !name) || !otp) {
      throw new BadRequestException('appName, email/name, and otp are required');
    }

    try {
      const { cn_str, dbName } = await this.resolveAppConfig(appName);
      const conn = await this.getConnection(cn_str, dbName);
      const db = conn.useDb(dbName);

      const usersCollection = db.collection<any>('appuser');
      const rolesCollection = db.collection<any>('approle');
      // const otpLogsCollection = db.collection<any>('otp_logs');

      const orFilters: any[] = [];
      if (email) orFilters.push({ 'sectionData.appuser.email': email.toLowerCase() });
      if (name) orFilters.push({ 'sectionData.appuser.mobile': name });

      const user = await usersCollection.findOne({ $or: orFilters.length ? orFilters : [{}] });
      if (!user) throw new NotFoundException('User not found');

      const role = await rolesCollection.findOne({ _id: user.sectionData.appuser.role });
      // if (!role) throw new NotFoundException('Role not found');

      // // ✅ Find latest OTP
      // const otpLog = await usersCollection.findOne(
      //   { userId: user._id.toString(), otp, used: false },
      //   { sort: { createdAt: -1 } },
      // );

      if (!otp) throw new UnauthorizedException('Invalid or expired OTP');
      if (new Date(otp.expiresAt) < new Date()) throw new UnauthorizedException('OTP expired');

      await usersCollection.updateOne({ _id: otp._id }, { $set: { used: true } });

      const { accessToken, refreshToken } = this.generateTokens(user._id.toString(), role._id.toString());

      return {
      success: true,
      message:'OTP verified successfully',
      accessToken: accessToken || undefined,
      refreshToken: refreshToken || undefined,
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
async mobileOtpLogin(dto: any) {
  const { appName, name } = dto;
  if (!appName || !name) {
    throw new BadRequestException('appName and name are required');
  }

  try {
    const { cn_str, dbName } = await this.resolveAppConfig(appName);
    const conn = await this.getConnection(cn_str, dbName);
    const db = conn.useDb(dbName);

    const usersCollection = db.collection<any>('appuser');
    // const otpLogsCollection = db.collection<any>('otp_logs');
    const smsCollection = db.collection<any>('sms');

    // Check if user exists
    let user = await usersCollection.findOne({
      'sectionData.appuser.mobile': name,
    });

    // Generate string userId
    let userId = user ? user._id.toString() : Date.now().toString();

    // If user does not exist, create temporary user with string _id
    if (!user) {
      user = {
        _id: userId,
        sectionData: {
          appuser: {
            name,
            mobile: name,
            panNumber: '',
            legalname: '',
            email: '',
            role: '',
            password: '',
          },
        },
      };
      await usersCollection.insertOne(user);
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Save OTP log with string IDs
    // await usersCollection.insertOne({
    //   _id: Date.now().toString(),
    //   // userId,
    //   otp,
    //   createdAt: new Date(),
    //   expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    //   used: false,
    // });

    // Send OTP via SMS
    const smsService = new SMSService();
    const smsConfigDoc = await smsCollection.findOne({});
    if (!smsConfigDoc?.sectionData?.sms) {
      throw new InternalServerErrorException('SMS configuration not found');
    }
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

    return {
      success: true,
      message: 'OTP sent successfully',
      // userId, // string
    };
  } catch (err: any) {
    throw new InternalServerErrorException(err.message);
  }
}


}