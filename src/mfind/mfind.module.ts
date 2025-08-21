// src/mfind/mfind.module.ts
import { Module } from '@nestjs/common';
import { MFindController } from './mfind.controller';
import { MFindService } from './mfind.service';
import { TokenGuard } from './mfind.token';

@Module({
  controllers: [MFindController],
  providers: [MFindService, TokenGuard],
})
export class MFindModule {}
