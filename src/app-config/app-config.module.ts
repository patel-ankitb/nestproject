import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service

@Module({
  controllers: [AppConfigController],
  providers: [AppConfigService, DatabaseService],
})
export class AppConfigModule {}