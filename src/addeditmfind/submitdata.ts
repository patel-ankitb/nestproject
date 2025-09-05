import { Controller, Post, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AddEditMFindService } from './addeditmfind.service';

@Controller('api')
export class submitdata {
  constructor(private readonly mfindService: AddEditMFindService) {}

  // single endpoint for add/edit
  @Post('dyn/submitdata')
  async save(@Req() req: Request, @Body() body: any) {
    // 👉 payload is optional now, no error throw

    if (body.docId) {
      body.isEdit = true;   // if docId given → EDIT mode
    } else {
      body.isAdd = true;    // if no docId → ADD mode
    }

    return this.mfindService.getModuleData(req.headers, body);
  }
}
