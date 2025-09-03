
import { Controller, Post, Body, Headers, Param, Get, UnauthorizedException, BadRequestException, Req } from '@nestjs/common';
import { MFindService } from './mfind.service';

@Controller()
export class MFindController {
  constructor(private readonly mfindService: MFindService) {}

  // 🔹 LOGIN
  @Post('login')
  async login(@Body() body: any) {
    return this.mfindService.login(body);
  }

  // 🔹 Run Aggregation with Token
  @Post(`mfind`)
  async find(
    @Body() body: any,
    @Headers('authorization') authHeader: string,
    @Req() req: any,
  ) {
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is required');
    }
    // Ensure the token is passed correctly, stripping "Bearer " if present
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    return this.mfindService.runAggregation(body, token, req);
  }

  // 🔹 Get Role by ID
  @Get('role/:appName/:roleId')
  async getRoleById(@Param('appName') appName: string, @Param('roleId') roleId: string) {
    return (this.mfindService as any).getRoleById(appName, roleId);
  }

  // 🔹 Get Role Modules Count
  @Get('role-modules-count/:appName')
  async getRoleModulesCount(@Param('appName') appName: string) {
    // Note: getRoleModulesCount is not defined in the service. This is a placeholder.
    throw new BadRequestException('Method not implemented');
  }
}
