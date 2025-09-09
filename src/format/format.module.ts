import { Module } from '@nestjs/common';
import { formatService } from './format.service';
import { formatController } from './format.controlelr';


@Module({
    controllers: [formatController],
    providers: [formatService]
})
export class formatmodule { }

