// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/databases.module';
import { MongooseModule } from '@nestjs/mongoose';
import { IoTData, IoTDataSchema } from './data/data.schema';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,

    // ✅ Register IoTData schema here
    MongooseModule.forFeature([{ name: IoTData.name, schema: IoTDataSchema }]),
  ],
})
export class AppModule {}
