import { Controller, Post, Body, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { DeleteCompanyService } from './delete-company.service';
import { DeleteCompanyDto } from './delete-company.dto';

@Controller('api/deleteCompany')
export class DeleteCompanyController {
  constructor(private readonly deleteCompanyService: DeleteCompanyService) {}

  @Post()
  async deleteCompany(
    @Body() deleteCompanyDto: DeleteCompanyDto,
    @Headers('authorization') token: string,
  ) {
    try {
      await this.deleteCompanyService.deleteCompany(deleteCompanyDto, token);
      return {
        success: true,
        message: 'Company and related records deleted successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Server Error: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}