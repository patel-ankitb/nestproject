    import { Module } from '@nestjs/common';
    import { MFindController } from './addeditmfind.controller';
    import { AddEditMFindService } from './addeditmfind.service';
    
    @Module({
      controllers: [MFindController],
      providers: [AddEditMFindService]
    })
    export class addeditmfindmodule {}
