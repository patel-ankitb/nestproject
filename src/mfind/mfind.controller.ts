import { Body, Controller, Post, Headers, HttpCode } from '@nestjs/common';
import { MFindService } from './mfind.service';

@Controller('mfind')
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  // ---------------- LOGIN ----------------
  @Post('login')
  async login(@Body() body: any) {
    // ✅ Pass username & password from body to service
    return this.mfindService.login(body);
  }

  // ---------------- REGISTER ----------------
  @Post('register')
  async register() {
    return { message: 'Static user, register disabled' };
  }

  // ---------------- AGGREGATION ----------------
  @Post()
  @HttpCode(200) // Explicitly set to 200 OK for data retrieval
  async mfind(@Body() body: any, @Headers() headers: any) {
    return this.mfindService.runAggregation(body, headers);
  }
}