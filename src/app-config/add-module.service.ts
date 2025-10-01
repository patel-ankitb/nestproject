import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { JwtService } from '../utils/jwt.service';
import { AddModuleDto } from './add-module.dto';
import { Collection, Document } from 'mongodb';

// Define interfaces for type safety
interface Route {
    type: string;
    title: string;
  }
  
  interface ModuleRoutes {
    module_name: string;
    routes: Route[];
  }
  
  interface RoutesConfig extends Document {
    code: string;
    modules: ModuleRoutes[];
  }
  
  interface SidebarLink {
    path: string;
    label: string;
    icon: string;
    mdl_nm: string;
  }
  
  interface SidebarConfig extends Document {
    code: string;
    data: {
      links: SidebarLink[];
    };
  }
  
  interface SchemaDocument extends Document {
    _id: string;
    code: string;
    name: string;
    collectionToSubmit: string;
    displayType?: string[];
    dash?: any;
    form?: any;
  }
  
  interface CustomApp extends Document {
    appnm: string;
    noOfModule?: number;
  }
  
  @Injectable()
  export class AddModuleService {
    constructor(
      private readonly mongoDBService: DatabaseService,
      private readonly jwtService: JwtService,
    ) {}
  
    async addModule(
      {
        appName,
        moduleName,
        listPath,
        dashTitle,
        listTitle,
        addTitle,
        editTitle,
        sidebarLabel,
        sidebarIcon,
        customFields,
        formJson,
        dashJson,
        onlyDashboard,
      }: AddModuleDto,
      token: string,
    ) {
      if (
        !appName ||
        !moduleName ||
        (!onlyDashboard &&
          (!listPath || !listTitle || !addTitle || !editTitle || !formJson)) ||
        (onlyDashboard && !dashJson)
      ) {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'All required fields must be provided',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
  
      const decoded = await this.jwtService.verifyAccessToken(token.replace('Bearer ', ''));
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
            message: 'Access denied. Only superadmin can add modules.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
  
      const schemaCollection: Collection<SchemaDocument> = appDb.collection('schema');
      const customAppsCollection: Collection<CustomApp> = this.mongoDBService.getDB('customize').collection('custom_apps');
  
      const appConfig = await customAppsCollection.findOne({ appnm: appName });
      const noOfModule = appConfig?.noOfModule || 30;
  
      const existingSchemas = await schemaCollection.countDocuments({
        code: {
          $not: { $in: ['ROUTES_CONFIG', 'SIDEBAR_CONFIG', 'VALIDATION_SCHEMA'] },
        },
      });
  
      if (existingSchemas >= noOfModule) {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.FORBIDDEN,
            message: `You have reached the module limit (${noOfModule}) for this app.`,
          },
          HttpStatus.FORBIDDEN,
        );
      }
  
      const moduleId = new Date().getTime().toString();
      const schemaCode = `${moduleName.toUpperCase()}_SCHEMA`;
      const fModName = moduleName.toLowerCase();
  
      const capitalizeFirstLetter = (string: string) =>
        string.charAt(0).toUpperCase() + string.slice(1);
  
      const fSidebarLabel = sidebarLabel || capitalizeFirstLetter(moduleName);
  
      const schema: SchemaDocument = {
        _id: moduleId,
        code: schemaCode,
        name: fModName,
        collectionToSubmit: moduleName.toLowerCase(),
        ...customFields,
        dash: typeof dashJson === 'string' ? JSON.parse(dashJson) : dashJson,
        form: typeof formJson === 'string' ? JSON.parse(formJson) : formJson,
      };
  
      await schemaCollection.insertOne(schema);
  
      const routes: Route[] = [];
      if (dashJson && dashJson.length > 0) {
        routes.push({
          type: 'dash',
          title: dashTitle || `${capitalizeFirstLetter(moduleName)} Dashboard`,
        });
      }
  
      if (!onlyDashboard) {
        routes.push(
          { type: 'list', title: listTitle! },
          { type: 'form-add', title: addTitle! },
          { type: 'form-edit', title: editTitle! },
        );
      }
  
      const routesConfig = await schemaCollection.findOne<RoutesConfig>({ code: 'ROUTES_CONFIG' });
      if (routesConfig) {
        const newModuleRoutes: ModuleRoutes = {
          module_name: fModName,
          routes,
        };
        await schemaCollection.updateOne(
          { code: 'ROUTES_CONFIG' },
          { $push: { modules: newModuleRoutes } as any }, // Use 'as any' to bypass strict typing if needed
        );
      } else {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Routes config not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }
  
      if (!onlyDashboard) {
        const sidebarConfig = await schemaCollection.findOne<SidebarConfig>({ code: 'SIDEBAR_CONFIG' });
        if (sidebarConfig) {
          const newSidebarLink: SidebarLink = {
            path: listPath!,
            label: fSidebarLabel,
            icon: sidebarIcon || "<i class='fa fa-list'></i>",
            mdl_nm: fModName,
          };
          await schemaCollection.updateOne(
            { code: 'SIDEBAR_CONFIG' },
            { $push: { 'data.links': newSidebarLink } as any }, // Use 'as any' to bypass strict typing if needed
          );
        } else {
          throw new HttpException(
            {
              status: false,
              statusCode: HttpStatus.NOT_FOUND,
              message: 'Sidebar config not found.',
            },
            HttpStatus.NOT_FOUND,
          );
        }
      }
    }
  }