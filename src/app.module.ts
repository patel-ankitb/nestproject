import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { DatabaseModule } from './database/databases.module';
import { MFindModule } from './mfind/mfind.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule,
    MFindModule,
  ],
})
export class AppModule {}
