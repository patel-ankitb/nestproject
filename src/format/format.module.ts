import { Module } from '@nestjs/common';
import { FormatService } from './format.service';
import { formatController } from './format.controlelr';


@Module({
    controllers: [formatController],
    providers: [FormatService]
})
export class formatmodule { }

