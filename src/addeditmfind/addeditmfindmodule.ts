    import { Module } from '@nestjs/common';
    import {  submitdata } from './submitdata';
    import { AddEditMFindService } from './addeditmfind.service';
    
    @Module({
      controllers: [submitdata],
      providers: [AddEditMFindService]
    })
    export class addeditmfindmodule {}

