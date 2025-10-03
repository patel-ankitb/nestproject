import { Controller, Post, Req, Res } from '@nestjs/common';
import { AddModuleService } from './addmodule.service';

@Controller('module')
export class AddModuleController {
  constructor(private readonly addModuleService: AddModuleService) {}

  @Post('add')
  async addModule(@Req() req, @Res() res) {
    return this.addModuleService.addModule(req, res);
  }
}
