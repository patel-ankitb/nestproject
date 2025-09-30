import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

@Controller('api/getAppConfig')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Post()
  async getAppConfig(@Body('appName') appName: string) {
    try {
      const config = await this.appConfigService.getAppConfig(appName);
      return {
        success: true,
        data: config,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException({success:false, message:'Server error', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}