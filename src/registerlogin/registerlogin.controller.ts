
import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { RegisterLoginService } from './registerlogin.service';

@Controller('auth')
export class RegisterLoginController {
  constructor(private readonly registerLoginService: RegisterLoginService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: any): Promise<any> {
    return this.registerLoginService.signupUser(body);
  }

 

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: any): Promise<any> {
    return this.registerLoginService.verifyOtp(body);
  }

  @Post('mobile-otp')
@HttpCode(HttpStatus.OK)
async mobileOtp(@Body() body: any): Promise<any> {
  return this.registerLoginService.mobileOtpLogin(body);
}

}