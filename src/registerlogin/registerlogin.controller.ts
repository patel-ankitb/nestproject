// import {
//   Controller,
//   Post,
//   Body,
//   HttpCode,
//   HttpStatus,
//   BadRequestException,
// } from '@nestjs/common';
// import { RegisterLoginService } from './registerlogin.service';

// @Controller('auth')
// export class RegisterLoginController {
//   constructor(private readonly registerLoginService: RegisterLoginService) {}

//   // ===== SIGNUP =====
//   @Post('signup')
//   @HttpCode(HttpStatus.CREATED)
//   async signup(@Body() body: any): Promise<any> {
//     if (!body || Object.keys(body).length === 0) {
//       throw new BadRequestException('Request body is empty');
//     }
//     return this.registerLoginService.signupUser(body);
//   }

//   // ===== LOGIN (OTP) =====
//   @Post('login')
//   @HttpCode(HttpStatus.OK)
//   async loginUser(@Body() body: any): Promise<any> {
//     if (!body || Object.keys(body).length === 0) {
//       throw new BadRequestException('Request body is empty');
//     }
//     return this.registerLoginService.loginUser(body);
//   }

//   // ===== VERIFY OTP =====
//   @Post('verify-otp')
//   @HttpCode(HttpStatus.OK)
//   async verifyOtp(@Body() body: any): Promise<any> {
//     if (!body || Object.keys(body).length === 0) {
//       throw new BadRequestException('Request body is empty');
//     }
//     return this.registerLoginService.verifyOtp(body);
//   }
// }
