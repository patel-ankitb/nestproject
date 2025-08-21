import { Body, Controller, Post } from '@nestjs/common';
import { MFindService } from './mfind.service';

@Controller('mfind')
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  @Post()
  async mfind(@Body() body: any) {
    try {
      console.log('📥 Request Body:', JSON.stringify(body, null, 2));
      const result = await this.mfindService.runAggregation(body);
      return {
        success: true,
        count: result.length,
        data: result,
      };
    } catch (error) {
      console.error('❌ mFind Error:', error);
      return { success: false, error: error.message };
    }
  }
}