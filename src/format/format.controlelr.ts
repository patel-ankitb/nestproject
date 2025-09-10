import { Controller, Post, Body, Headers, BadRequestException } from '@nestjs/common';
import { FormatService } from './format.service';

@Controller('api')
export class formatController {
  constructor(private readonly formatService: FormatService) {}

  @Post('format/getModuleData')
  async getModuleData(
    @Headers() headers: any,
    @Body() body: any,
  ): Promise<any> {
    try {
      return await this.formatService.getModuleData(headers, body);
    } catch (err) {
      throw new BadRequestException(err.message || 'Failed to fetch data');
    }
  }
  
}
