import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { JwtService } from '../utils/jwt.service';
import { DeleteCompanyDto } from './delete-company.dto';
import { Collection, Document } from 'mongodb';

interface CompanyDocument extends Document {
  _id: string;
  companyId?: string;
}

@Injectable()
export class DeleteCompanyService {
  constructor(
    private readonly mongoDBService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async deleteCompany({ companyId, appName }: DeleteCompanyDto, token: string) {
    if (!companyId || !appName || !token) {
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Company ID, appName, and token are required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Verify JWT token
      const tokenParts = token.split(' ');
      const actualToken =
        tokenParts.length === 2 && tokenParts[0] === 'Bearer'
          ? tokenParts[1]
          : token;

      const decoded = await this.jwtService.verifyAccessToken(actualToken);
      if (!decoded) {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.UNAUTHORIZED,
            message: 'Invalid token.',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }

      const { userId, roleId } = decoded;

      // Check user and role in app-specific database
      const appDb = await this.mongoDBService.getAppDB(appName);
      const usersCollection = appDb.collection('appuser');
      const rolesCollection = appDb.collection('approle');

      const user = await usersCollection.findOne({ _id: userId });
      if (!user) {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.FORBIDDEN,
            message: 'User not found.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const role = await rolesCollection.findOne({ _id: roleId });
      if (!role || role.sectionData.approle.role !== 'superadmin') {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Access denied. Only superadmin can delete companies.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const companyCollection: Collection<CompanyDocument> = appDb.collection('company');
      const companyDeleteResult = await companyCollection.deleteOne({ _id: companyId });
      if (companyDeleteResult.deletedCount === 0) {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Company not found',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      
      // Delete related records and company
      const collections = await appDb.collections();
      for (const collection of collections) {
        const sampleDocument = await collection.findOne({ companyId });
        if (sampleDocument && sampleDocument.companyId !== undefined) {
          await collection.deleteMany({ companyId });
        }
      }

      
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `Error deleting company: ${error.message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}