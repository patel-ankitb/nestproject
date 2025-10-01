import { Controller, Post, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { CreateModuleService } from './create-module.service';
import { CreateModuleDto } from './create-module.dto';

@Controller('api/build-hana-module')
export class CreateModuleController {
  constructor(private readonly createModuleService: CreateModuleService) {}

  @Post(':appName')
  async createModuleByBuildHANA(
    @Param('appName') appName: string,
    @Body() createModuleDto: CreateModuleDto,
    @Headers('authorization') token: string,
  ) {
    try {
      await this.createModuleService.createModuleByBuildHANA(appName, createModuleDto, token);
      return {
        success: true,
        message: 'Module, routes, and sidebar added successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Server Error: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}