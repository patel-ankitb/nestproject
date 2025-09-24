import { Module } from '@nestjs/common';

import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { UploadController } from './file.controller';
import { UploadService } from './file.service';
import { DatabaseService } from 'src/databases/database.service';
import { EmailService } from './email.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      useFactory: () => ({
        storage: diskStorage({
          destination: (req, file, cb) => {
            const { appName, moduleName } = req.params;
            const fieldName = req.body.fieldName
              ? req.body.fieldName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\s+/g, '_')
              : null;
            const uploadPath = fieldName
              ? path.join(__dirname, '../../Uploads', appName, moduleName, fieldName)
              : path.join(__dirname, '../../Uploads', appName, moduleName);
            if (!fs.existsSync(uploadPath)) {
              fs.mkdirSync(uploadPath, { recursive: true });
            }
            cb(null, uploadPath);
          },
          filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, `file-${uniqueSuffix}${path.extname(file.originalname)}`);
          },
        }),
      }),
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, DatabaseService, EmailService  ],

})
export class UploadModule {}