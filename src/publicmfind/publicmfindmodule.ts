import { Module } from '@nestjs/common';
import { MFindController } from './publicmfind.controller';
import { MFindService } from './publicmfind.service';

@Module({
  controllers: [MFindController],
  providers: [MFindService]
})
export class publicmfindmodule {}
