import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { DatabaseModule } from './database/databases.module';
import { MFindModule } from './mfind/mfind.module';
import { publicmfindmodule } from './publicmfind/publicmfindmodule';
import { addeditmfindmodule } from './addeditmfind/addeditmfindmodule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule,
    MFindModule,
    publicmfindmodule,
    addeditmfindmodule

  ],
})
export class AppModule {}
