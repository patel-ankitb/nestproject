    import { Module } from '@nestjs/common';
    import { AdddEditMFindController } from './addeditmfind.controller';
    import { AddEditMFindService } from './addeditmfind.service';
    
    @Module({
      controllers: [AdddEditMFindController],
      providers: [AddEditMFindService]
    })
    export class addeditmfindmodule {}

    