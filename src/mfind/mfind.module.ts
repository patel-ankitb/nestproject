// src/mfind/mfind.module.ts
import { Module } from '@nestjs/common';
import { MFindController } from './mfind.controller';
import { MFindService } from './mfind.service';

@Module({
  controllers: [MFindController],
  providers: [MFindService],
})
export class MFindModule {}
