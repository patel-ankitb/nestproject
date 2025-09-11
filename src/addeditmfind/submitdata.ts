import { Controller, Post, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AddEditMFindService } from './addeditmfind.service';

@Controller('api')
export class submitdata {
  constructor(private readonly mfindService: AddEditMFindService) {}

  // single endpoint for add/edit
  @Post('dynamic/submitdata')
  async save(@Req() req: Request, @Body() body: any): Promise<any> {
    // 👉 payload is optional now, no error throw
    // console.log('Received payload:', body);
    if (body.docId) {
      body.isEdit = true;   // if docId given → EDIT mode
    } else {
      body.isAdd = true;    // if no docId → ADD mode
    }

    return this.mfindService.getModuleData(req.headers, body);
  }
}
