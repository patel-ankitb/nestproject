    import { Module } from '@nestjs/common';
    import {  submitdata } from './submitdata';
    import { AddEditMFindService } from './addeditmfind.service';
import { DatabaseService } from 'src/databases/database.service';
    
    @Module({
      controllers: [submitdata],
      providers: [AddEditMFindService,DatabaseService]
    })
    export class addeditmfindmodule {}

