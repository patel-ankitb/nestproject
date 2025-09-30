import { Controller, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { SaveConfigurationsService } from './save-configurations.service';
import { SaveConfigDto } from './save-config.dto';

@Controller('api/saveConfigurations')
export class SaveConfigurationsController {
  constructor(private readonly saveConfigurationsService: SaveConfigurationsService) {}

  @Post(':appName')
  async saveConfigurations(
    @Param('appName') appName: string,
    @Body() saveConfigDto: SaveConfigDto,
  ) {
    try {
      console.log("save config");
      
      await this.saveConfigurationsService.saveConfigurations(appName, saveConfigDto);
      console.log("saved config");

      return {
        success: true,
        message: 'Configurations saved successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException({success:false, message:'Error saving configurations', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}