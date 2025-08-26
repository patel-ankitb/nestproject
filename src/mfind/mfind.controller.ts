import { Controller, Post, Body, Headers, Req } from '@nestjs/common';
import { MFindService } from './mfind.service';
import type { Request } from 'express';

@Controller('mfind')
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  // ---------------- LOGIN ----------------
  @Post('login')
  async login(
    @Body() body: { appName: string; name: string; password: string },
  ) {
    // body must include: appName, name, password
    return this.mfindService.login(body);
  }

  // ---------------- RUN AGGREGATION (FIND) ----------------
  @Post()
  async runAggregation(
    @Body()
    body: { appName: string; collectionName: string; pipeline: any[] },
    @Headers('authorization') token: string,
    @Req() req: Request,
  ) {
    return this.mfindService.runAggregation(body, token, req);
  }
}
