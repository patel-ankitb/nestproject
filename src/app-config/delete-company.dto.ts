import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteCompanyDto {
  @IsString()
  @IsNotEmpty()
  companyId: string;

  @IsString()
  @IsNotEmpty()
  appName: string;
}