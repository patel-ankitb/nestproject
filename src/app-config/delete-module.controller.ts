import { Controller, Post, Body, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { DeleteModuleService } from './delete-module.service';
import { DeleteModuleDto } from './delete-module.dto';

@Controller('api/deleteModule')
export class DeleteModuleController {
  constructor(private readonly deleteModuleService: DeleteModuleService) {}

  @Post()
  async deleteModule(
    @Body() deleteModuleDto: DeleteModuleDto,
    @Headers('authorization') token: string,
  ) {
    try {
      await this.deleteModuleService.deleteModule(deleteModuleDto, token);
      return {
        success: true,
        message: 'Module, routes, and sidebar link deleted successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: `Error deleting module: ${error.message}`,
          data: {},
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}