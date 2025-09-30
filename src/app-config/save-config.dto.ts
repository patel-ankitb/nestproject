import { IsString, IsNotEmpty, IsIn, IsObject } from 'class-validator';

export class SaveConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['sidebar', 'routes'])
  type: string;

  @IsObject()
  @IsNotEmpty()
  config: object;
}