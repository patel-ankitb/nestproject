import { Controller, Post, Body, Headers } from '@nestjs/common';
import { MFindService } from './mfind.service';

@Controller('mfind')
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  @Post('login')
  async login(@Body() body: any) {
    return this.mfindService.login(body);
  }

  @Post()
  async mfind(@Body() body: any, @Headers() headers: any) {
    return this.mfindService.runAggregation(body, headers);
  }
}
