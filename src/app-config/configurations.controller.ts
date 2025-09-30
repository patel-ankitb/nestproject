import { Controller, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigurationsService } from './configurations.service';

@Controller('api/getConfigurations')
export class ConfigurationsController {
  constructor(private readonly configurationsService: ConfigurationsService) {}

  @Get(':appName')
  async getConfigurations(@Param('appName') appName: string) {
    try {
      const config = await this.configurationsService.getConfigurations(appName);
      return {
        success: true,
        data: config,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException({success:false, message:'Error fetching configurations', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}