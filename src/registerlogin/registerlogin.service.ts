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

      // ===== Check existing user =====
      const orFilters: any[] = [];
      if (email) orFilters.push({ 'sectionData.appuser.email': email.toLowerCase() });
      if (mobile) orFilters.push({ 'sectionData.appuser.mobile': mobile });

      const existingUser = await usersCollection.findOne({ $or: orFilters.length ? orFilters : [{}] });
      if (existingUser) throw new BadRequestException('User with this email/mobile already exists');

      const assignedRole = await rolesCollection.findOne({ _id: role });
      if (!assignedRole) throw new NotFoundException('Provided role not found');

      const hashedPassword =
        password && !['otp', 'oauth'].includes(type) ? await bcrypt.hash(password, 10) : '';

      const newUserId = Date.now().toString(); // ✅ always string
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
          _id: Date.now().toString(), // ✅ string id
          userId: newUserId,
          otp,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          used: false,
        });

        await smsService.sendMessage(appName, cn_str, dbName, smsConfigId, mobile, otp, 'otp');

        return {
          success: true,
          message: 'Signup successful, OTP sent to mobile',
          user: {
            _id: newUser._id,
            name: newUser.sectionData.appuser.name,
            legalname: newUser.sectionData.appuser.legalname,
            panNumber: newUser.sectionData.appuser.panNumber,
            mobile: newUser.sectionData.appuser.mobile,
            role: assignedRole.sectionData?.approle,
          },
        };
      }

      // ===== Normal signup logs =====
      await logsCollection.insertOne({
        _id: Date.now().toString(),
        u_id: newUserId,
        r_id: assignedRole._id.toString(),
        tokenVersion: 1,
        logs: [{ type: 'in', time: new Date() }],
      });

      const { accessToken, refreshToken } = this.generateTokens(newUserId, assignedRole._id.toString());

      return {
        success: true,
        message: 'Signup successful',
        accessToken,
        refreshToken,
        user: {
          _id: newUserId,
          name: newUser.sectionData.appuser.name,
          legalname: newUser.sectionData.appuser.legalname,
          panNumber: newUser.sectionData.appuser.panNumber,
          mobile: newUser.sectionData.appuser.mobile,
          role: assignedRole.sectionData?.approle,
        },
      };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  // ===== LOGIN =====
  async loginUser(dto: any) {
    const { appName, email, name, password, type } = dto;
    if (!appName || (!email && !name)) throw new BadRequestException('appName and email/name required');

    try {
      const { cn_str, dbName } = await this.resolveAppConfig(appName);
      const conn = await this.getConnection(cn_str, dbName);
      const db = conn.useDb(dbName);

      const usersCollection = db.collection<any>('appuser');
      const rolesCollection = db.collection<any>('approle');
      const logsCollection = db.collection<any>('login_logs');
      const otpLogsCollection = db.collection<any>('otp_logs');

      // Build search filters
      const orFilters: any[] = [];
      if (email) orFilters.push({ 'sectionData.appuser.email': email.toLowerCase() });
      if (name) orFilters.push({ 'sectionData.appuser.mobile': name });

      const user = await usersCollection.findOne({ $or: orFilters.length ? orFilters : [{}] });
      if (!user) throw new NotFoundException('User not found');

      const role = await rolesCollection.findOne({ _id: user.sectionData.appuser.role });
      if (!role) throw new NotFoundException('Role not found');

      if (type !== 'otp') {
        const valid = await bcrypt.compare(password, user.sectionData.appuser.password || '');
        if (!valid) throw new UnauthorizedException('Invalid password');

        await logsCollection.insertOne({
          _id: Date.now().toString(),
          u_id: user._id.toString(),
          r_id: role._id.toString(),
          tokenVersion: 1,
          logs: [{ type: 'in', time: new Date() }],
        });

        const { accessToken, refreshToken } = this.generateTokens(user._id.toString(), role._id.toString());

        return {
          success: true,
          message: 'Login successful',
          accessToken,
          refreshToken,
          user: {
            _id: user._id.toString(),
            username: user.sectionData.appuser.name,
            legalname: user.sectionData.appuser.legalname,
            role: role.sectionData?.approle,
          },
        };
      } else {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        await otpLogsCollection.insertOne({
          _id: Date.now().toString(),
          userId: user._id.toString(),
          otp,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          used: false,
        });

        const smsService = new SMSService();
        const smsConfigDoc = await db.collection('sms').findOne({});
        if (!smsConfigDoc?.sectionData?.sms) throw new InternalServerErrorException('SMS configuration not found');
        const smsConfigId = smsConfigDoc._id.toString();

        await smsService.sendMessage(appName, cn_str, dbName, smsConfigId, user.sectionData.appuser.mobile, otp, 'otp');

        return {
          success: true,
          message: 'OTP sent to mobile',
          userId: user._id.toString(),
        };
      }
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

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
    const otpLogsCollection = db.collection<any>('otp_logs');

    // 🔹 Find user
    const orFilters: any[] = [];
    if (email) orFilters.push({ 'sectionData.appuser.email': email.toLowerCase() });
    if (name) orFilters.push({ 'sectionData.appuser.mobile': name });

    const user = await usersCollection.findOne({ $or: orFilters.length ? orFilters : [{}] });
    if (!user) throw new NotFoundException('User not found');

    // 🔹 Validate OTP
    // const otpDoc = await otpLogsCollection.findOne({
    //   userId: user._id.toString(),
    //   otp,
    //   expiresAt: { $gt: new Date() },
    //   used: false,
    // });

    if (!otp) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // 🔹 Mark OTP as used
    await otpLogsCollection.updateOne(
      { _id: otp._id },
      { $set: { used: true } }
    );

    // 🔹 Get role
    const role = await rolesCollection.findOne({ _id: user.sectionData.appuser.role });
    if (!role) throw new NotFoundException('Role not found');

    // 🔹 Generate tokens
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
        _id: user._id.toString(), // ✅ always string
        username: user.sectionData.appuser.name,
        legalname: user.sectionData.appuser.legalname,
        role: role.sectionData?.approle,
      },
    };
  } catch (err: any) {
    throw new InternalServerErrorException(err.message);
  }
}

}
