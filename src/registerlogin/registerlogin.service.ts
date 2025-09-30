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

  // ===== SIGNUP =====
  async signupUser(dto: any) {
    const { appName, name, email, password, role, mobile = '', type } = dto;

    if (
      !appName ||
      !email ||
      (!password && !['otp', 'oauth'].includes(type)) ||
      !role
    ) {
      throw new BadRequestException(
        'appName, email, password (unless OTP/OAuth), and role are required',
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
          { 'sectionData.appuser.name': email.toLowerCase() },
          { 'sectionData.appuser.email': email.toLowerCase() },
        ],
      });
      if (existingUser)
        throw new BadRequestException('User with this email already exists');

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
            name: email.toLowerCase(),
            legalname: name,
            email: email.toLowerCase(),
            mobile,
            role: assignedRole._id,
            password: hashedPassword,
          },
        },
      };

      await usersCollection.insertOne(newUser);

      // ===== OTP Signup =====
      if (type === 'otp') {
        await this.otpService.sendOtp(email.toLowerCase(), 4, 2, appName);
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
      await this.otpService.sendOtp(name, 4, 2, appName);

      return { success: true, message: 'OTP sent successfully', userId: name };
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

    const uniqueId = email || name;
    const result = await this.otpService.verifyOtp(uniqueId, otp, appName);

    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return { success: true, message: 'OTP verified successfully' };
  }
}
