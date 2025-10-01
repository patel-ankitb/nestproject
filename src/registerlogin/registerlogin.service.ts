import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { OtpService } from './otp';
import { DatabaseService } from '../databases/database.service';
import { Db } from 'mongodb';

@Injectable()
export class RegisterLoginService {
  constructor(
    @Inject(forwardRef(() => OtpService))
    private readonly otpService: OtpService,
    private readonly databaseService: DatabaseService,
  ) {}

  // ===== JWT Tokens =====
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

  // ===== Unified OTP Sender =====
  private async sendOtp(uniqueId: string, appName: string) {
    const isMobile = /^\+\d{7,15}$/.test(uniqueId);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uniqueId);

    if (isMobile || isEmail) {
      return this.otpService.sendOtp(uniqueId, 4, 2, appName);
    } else {
      throw new BadRequestException(`Invalid mobile/email: ${uniqueId}`);
    }
  }

  // ===== SIGNUP =====
  async signupUser(dto: any) {
    const { appName, name, email, password, role, mobile = '', type } = dto;

    if (
      !appName ||
      (!password && !['otp', 'oauth'].includes(type)) ||
      !role ||
      (!email && !mobile)
    ) {
      throw new BadRequestException(
        'appName, email/mobile, password (unless OTP/OAuth), and role are required',
      );
    }

    try {
      const db: Db = await this.databaseService.getAppDB(appName);
      const usersCollection = db.collection<any>('appuser');
      const rolesCollection = db.collection<any>('approle');
      const logsCollection = db.collection<any>('login_logs');

      // Check existing user
      const existingUser = await usersCollection.findOne({
        $or: [
          { 'sectionData.appuser.email': email?.toLowerCase() },
          { 'sectionData.appuser.mobile': mobile },
        ],
      });
      if (existingUser)
        throw new BadRequestException('User with this email or mobile already exists');

      // Check role exists
      const assignedRole = await rolesCollection.findOne({ _id: role });
      if (!assignedRole) throw new NotFoundException('Provided role not found');

      // Hash password if not OTP/OAuth
      const hashedPassword =
        password && !['otp', 'oauth'].includes(type)
          ? await bcrypt.hash(password, 10)
          : '';

      const newUser: any = {
        _id: Date.now().toString(),
        sectionData: {
          appuser: {
            name: email?.toLowerCase() || mobile,
            legalname: name,
            email: email?.toLowerCase(),
            mobile,
            role: assignedRole._id,
            password: hashedPassword,
          },
        },
      };

      await usersCollection.insertOne(newUser);

      // ===== OTP Signup =====
      if (type === 'otp') {
        await this.sendOtp(email || mobile, appName);
        return { success: true, message: 'Signup successful, OTP required' };
      }

      // Log user
      await logsCollection.insertOne({
        _id: Date.now().toString(),
        u_id: newUser._id,
        r_id: assignedRole._id,
        tokenVersion: 1,
        logs: [{ type: 'in', time: new Date() }],
      });

      const { accessToken, refreshToken } = this.generateTokens(
        newUser._id,
        assignedRole._id,
        1,
      );

      return {
        success: true,
        message: 'Signup successful',
        accessToken,
        refreshToken,
        user: {
          _id: newUser._id,
          username: newUser.sectionData.appuser.name,
          role: assignedRole.sectionData?.approle,
        },
      };
    } catch (error: any) {
      throw new InternalServerErrorException(error.message);
    }
  }

  // ===== LOGIN (OTP) =====
  async loginUser(dto: any) {
    const { appName, name, type } = dto;
    if (!appName) throw new BadRequestException('appName is required');
    if (type === 'otp' && !name)
      throw new BadRequestException('Name (mobile/email) is required');

    try {
      await this.databaseService.getAppDB(appName);

      // Send OTP
      await this.sendOtp(name, appName);

      return { success: true, message: 'OTP sent successfully', userId: name };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  // ===== VERIFY OTP (LOGIN) =====
  async verifyOtp(dto: any) {
    const { appName, email, name, otp } = dto;
    if (!appName || (!email && !name) || !otp) {
      throw new BadRequestException('appName, email/name, and otp are required');
    }

    const uniqueId = email || name;

    // Step 1: Verify OTP
    const result = await this.otpService.verifyOtp(uniqueId, otp, appName);
    if (!result.success) {
      throw new BadRequestException(result.message || 'Invalid OTP');
    }

    // Step 2: Get DB
    const db: Db = await this.databaseService.getAppDB(appName);
    const usersCollection = db.collection<any>('appuser');
    const rolesCollection = db.collection<any>('approle');
    const logsCollection = db.collection<any>('login_logs');

    // Step 3: Find user
    const user = await usersCollection.findOne({
      $or: [
        { 'sectionData.appuser.email': email?.toLowerCase() },
        { 'sectionData.appuser.mobile': name },
      ],
    });
    if (!user) throw new NotFoundException('User not found');

    // Step 4: Find role
    const assignedRole = await rolesCollection.findOne({ _id: user.sectionData.appuser.role });
    if (!assignedRole) throw new NotFoundException('Role not found');

    // Step 5: Log user login
    await logsCollection.insertOne({
      _id: Date.now().toString(),
      u_id: user._id,
      r_id: assignedRole._id,
      tokenVersion: 1,
      logs: [{ type: 'in', time: new Date() }],
    });

    // Step 6: Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(
      user._id,
      assignedRole._id,
      1,
    );

    return {
      success: true,
      message: 'OTP verified successfully',
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        username: user.sectionData.appuser.name,
        role: assignedRole.sectionData?.approle,
      },
    };
  }
}
