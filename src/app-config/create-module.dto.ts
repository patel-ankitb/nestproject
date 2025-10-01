import { IsString, IsNotEmpty } from 'class-validator';

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  _id: string;

  @IsString()
  @IsNotEmpty()
  moduleName: string;
}