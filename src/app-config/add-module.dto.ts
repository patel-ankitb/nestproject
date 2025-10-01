import { IsString, IsNotEmpty, IsOptional, IsArray, IsObject, IsBoolean } from 'class-validator';

export class AddModuleDto {
  @IsString()
  @IsNotEmpty()
  appName: string;

  @IsString()
  @IsNotEmpty()
  moduleName: string;

  @IsString()
  @IsOptional()
  listPath?: string;

  @IsString()
  @IsOptional()
  dashTitle?: string;

  @IsString()
  @IsOptional()
  listTitle?: string;

  @IsString()
  @IsOptional()
  addTitle?: string;

  @IsString()
  @IsOptional()
  editTitle?: string;

  @IsString()
  @IsOptional()
  sidebarLabel?: string;

  @IsString()
  @IsOptional()
  sidebarIcon?: string;

  @IsObject()
  @IsOptional()
  customFields?: object;

  @IsOptional()
  formJson?: any;

  @IsOptional()
  dashJson?: any;

  @IsBoolean()
  @IsOptional()
  onlyDashboard?: boolean;
}