import {
  Controller,
  Post,
  Param,
  UseInterceptors,
  UploadedFile,
  Res,
  Body,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UploadService } from './file.service';

@Controller('optimizeUpload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post(':appName/:moduleName')
  @UseInterceptors(FileInterceptor('file'))
  async processFileUpload(
    @Param('appName') appName: string,
    @Param('moduleName') moduleName: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Res() res: Response,
  ) {
    this.logger.log(`Received request for app: ${appName}, module: ${moduleName}, body: ${JSON.stringify(body)}`);
    try {
      const result = await this.uploadService.processFileUpload(
        appName,
        moduleName,
        file,
        body,
      );
      this.logger.log(`Successful response: ${JSON.stringify(result)}`);
      return res.status(HttpStatus.OK).json(result);
    } catch (error) {
      this.logger.error(`Error processing request: ${error.message}`, error.stack);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'An unexpected error occurred.',
        error: error.message,
      });
    }
  }
}