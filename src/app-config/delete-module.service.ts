import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { JwtService } from '../utils/jwt.service';
import { DeleteModuleDto } from './delete-module.dto';
import { Collection, Document } from 'mongodb';
import * as fs from 'fs';

interface SchemaDocument extends Document {
  _id: string;
  code: string;
}

// Specific interfaces for ROUTES_CONFIG and SIDEBAR_CONFIG
interface ModuleRoute {
  module_name: string;
}

interface RoutesConfig extends SchemaDocument {
  modules: ModuleRoute[];
}

interface SidebarLink {
  mdl_nm: string;
}

interface SidebarConfig extends SchemaDocument {
  data: {
    links: SidebarLink[];
  };
}

@Injectable()
export class DeleteModuleService {
  private readonly logger = new Logger(DeleteModuleService.name);

  constructor(
    private readonly mongoDBService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async deleteModule({ appName, moduleName }: DeleteModuleDto, token: string) {
    if (!appName || !moduleName || !token) {
      throw new HttpException(
        {
          success: false,
          message: 'App name, module name, and token are required',
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
            success: false,
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
            success: false,
            message: 'User not found.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const role = await rolesCollection.findOne({ _id: roleId });
      if (!role || role.sectionData.approle.role !== 'superadmin') {
        throw new HttpException(
          {
            success: false,
            message: 'Access denied. Only superadmin can delete modules.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const schemaCollection: Collection<SchemaDocument> = appDb.collection('schema');
      const fModName = moduleName.toLowerCase();

      // Delete the module schema
      const schemaResult = await schemaCollection.deleteOne({
        code: `${moduleName.toUpperCase()}_SCHEMA`,
      });

      if (schemaResult.deletedCount === 0) {
        throw new HttpException(
          {
            success: false,
            message: 'Module not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      // Update ROUTES_CONFIG and SIDEBAR_CONFIG in parallel
      const [routesConfig, sidebarConfig] = await Promise.all([
        schemaCollection.findOne<RoutesConfig>({ code: 'ROUTES_CONFIG' }),
        schemaCollection.findOne<SidebarConfig>({ code: 'SIDEBAR_CONFIG' }),
      ]);

      const updatePromises: Promise<any>[] = [];

      if (routesConfig) {
        updatePromises.push(
          schemaCollection.updateOne(
            { code: 'ROUTES_CONFIG' },
            {
              $pull: { modules: { module_name: fModName } } as any,
            },
          ),
        );
      } else {
        throw new HttpException(
          {
            success: false,
            message: 'Routes config not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (sidebarConfig) {
        updatePromises.push(
          schemaCollection.updateOne(
            { code: 'SIDEBAR_CONFIG' },
            {
              $pull: { 'data.links': { mdl_nm: fModName } } as any,
            },
          ),
        );
      } else {
        throw new HttpException(
          {
            success: false,
            message: 'Sidebar config not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      await Promise.all(updatePromises);

      // Check and drop module collection if empty
      const collections = await appDb.listCollections().toArray();
      const collectionExists = collections.some((col) => col.name === fModName);

      if (collectionExists) {
        const moduleCollection = appDb.collection(fModName);
        const moduleDataCount = await moduleCollection.countDocuments();

        if (moduleDataCount === 0) {
          await moduleCollection.drop();
          this.logger.log(`Collection ${fModName} dropped successfully.`);
        }
      }

    } catch (error) {
    
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: `Error deleting module: ${error.message}`,
          data: {},
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}