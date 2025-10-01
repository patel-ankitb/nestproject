import { Controller, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { BasicModulesService } from './basic-modules.service';
import { GetBasicModulesDto } from './get-basic-modules.dto';

@Controller('api/get-basic-modules')
export class BasicModulesController {
  constructor(private readonly basicModulesService: BasicModulesService) {}

  @Post(':appName')
  async getBasicModules(
    @Param('appName') appName: string,
    @Body() getBasicModulesDto: GetBasicModulesDto,
  ) {
    try {
      const { data, count, totalCount } = await this.basicModulesService.getBasicModules(
        appName,
        getBasicModulesDto,
      );
      return {
        success: true,
        message: 'These are the basic modules',
        count,
        totalCount,
        data,
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