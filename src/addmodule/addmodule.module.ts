import { Module } from '@nestjs/common';
import { AddModuleController } from './addmodule.cotroller';
import { AddModuleService } from './/addmodule.service';

@Module({
  controllers: [AddModuleController],
  providers: [AddModuleService],
  exports: [AddModuleService],
})
export class AddModuleModule {}
