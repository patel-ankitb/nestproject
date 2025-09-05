import { Module } from '@nestjs/common';
import { PublicMFindController } from './publicmfind.controller';
import {  PublicMFindService } from './publicmfind.service';

@Module({
  controllers: [PublicMFindController],
  providers: [PublicMFindService]
})
export class publicmfindmodule {}
