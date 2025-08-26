import { Controller, Post, Body, Headers, Param, Get } from '@nestjs/common';
import { MFindService } from './mfind.service';

@Controller('mfind')
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  @Post('login')
  async login(@Body() body: any) {
    return this.mfindService.login(body);
  }

  @Post()
  async find(@Body() body: any, @Headers('authorization') authHeader: string, @Headers() headers: any) {
    return this.mfindService.runAggregation(body, authHeader, headers);
  }

  @Get('role/:appName/:roleId')
  async getRoleById(@Param('appName') appName: string, @Param('roleId') roleId: string) {
    return this.mfindService.getRoleById(appName, roleId);
  }

  @Get('role-modules-count/:appName')
  async getRoleModulesCount(@Param('appName') appName: string) {
    return this.mfindService.getRoleModulesCount(appName);
  }
}
