import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteModuleDto {
  @IsString()
  @IsNotEmpty()
  appName: string;

  @IsString()
  @IsNotEmpty()
  moduleName: string;
}