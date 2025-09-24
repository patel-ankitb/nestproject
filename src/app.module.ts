import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { DatabaseModule } from './database/databases.module';
import { MFindModule } from './mfind/mfind.module';
import { publicmfindmodule } from './publicmfind/publicmfindmodule';
import { addeditmfindmodule } from './addeditmfind/addeditmfindmodule';
import { format } from 'path';
import { formatmodule } from './format/format.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { UploadModule } from './fileupload/file.module';
// import { filemodule } from './fileupload/file.module';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule,
    MFindModule,
    publicmfindmodule,
    addeditmfindmodule,
    formatmodule,
     EvaluationModule,
    //  filemodule
    UploadModule

  ],
  // controllers: [FormatcontrollerController],
})
export class AppModule {}
