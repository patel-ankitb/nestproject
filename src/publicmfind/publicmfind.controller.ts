import { Controller, Post, Body, Req, BadRequestException } from '@nestjs/common';
import { MFindService } from './publicmfind.service';
import type { Request } from 'express';

@Controller('public')
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  @Post('mfind')
  async fetchModuleData(@Req() req: Request, @Body() body: any) {
    const key = req.headers['x-api-key'];
    if (!key) throw new BadRequestException("Key is required in headers");
    if (!body.moduleName) throw new BadRequestException("moduleName is required in body");

    // Pass merged headers (normalize key)
    return this.mfindService.getModuleData({ ...req.headers, key }, body);
  }
}
