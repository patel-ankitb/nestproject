import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class GetBasicModulesDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 30;

  @IsInt()
  @Min(0)
  @IsOptional()
  skip?: number = 0;

  @IsString()
  @IsOptional()
  filter?: string = '';
}