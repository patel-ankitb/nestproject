    import { Module } from '@nestjs/common';
    import { AdddEditMFindController } from './addeditmfinds.controller';
    import { AddEditMFindService } from './addeditmfind.service';
    
    @Module({
      controllers: [AdddEditMFindController],
      providers: [AddEditMFindService]
    })
    export class addeditmfindmodule {}

