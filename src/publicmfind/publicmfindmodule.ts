import { Module } from '@nestjs/common';
import { PublicMFindController } from './publicmfind.controller';
import {  PublicMFindService } from './publicmfind.service';
import { DatabaseService } from 'src/databases/database.service';

@Module({
  controllers: [PublicMFindController],
  providers: [PublicMFindService,DatabaseService]
})
export class publicmfindmodule {}
