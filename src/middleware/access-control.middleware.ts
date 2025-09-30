import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { JwtService } from '../utils/jwt.service';

@Injectable()
export class AccessControlMiddleware implements NestMiddleware {
  constructor(
    private readonly mongoDBService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const action = req.method === 'POST' ? 'save-config' : 'get-config';
    const { appName, moduleName } = req.params;
    const token = req.headers.authorization;

    if (!token) {
      throw new HttpException({success:false, message:'Token is required.', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.FORBIDDEN);
    }

    try {
      const tokenParts = token.split(' ');
      const actualToken =
        tokenParts.length === 2 && tokenParts[0] === 'Bearer'
          ? tokenParts[1]
          : token;

      const decoded = await this.jwtService.verifyAccessToken(actualToken);
      
      if (!decoded) {
        throw new HttpException({success:false, message:'Invalid token.', statusCode:HttpStatus.UNAUTHORIZED},HttpStatus.UNAUTHORIZED);
      }

      const { userId, roleId } = decoded;

      const appDb = await this.mongoDBService.getAppDB(appName);
      const usersCollection = appDb.collection('appuser');
      const rolesCollection = appDb.collection('approle');

      const user = await usersCollection.findOne({ _id: userId });
      if (!user) {
        throw new HttpException({success:false, message:'User not found.', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.FORBIDDEN);
      }

      const role = await rolesCollection.findOne({ _id: roleId });
      if (!role) {
        throw new HttpException({success:false, message:'Role not found.', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.FORBIDDEN);
      }

      if (role.sectionData.approle.role === 'superadmin') {
        return next();
      }

      const accessControlList = {
        'upload image': ['canAdd', 'canEdit'],
        'add new data': ['canAdd'],
        'edit data': ['canEdit'],
        'get-config': ['canRead'],
        'save-config': ['canEdit'],
        'create-module': ['canCreateModule'],
      };

      const moduleAccess = role.sectionData.approle.modules.find(
        (mdl: any) => mdl.module === moduleName,
      );
      if (!moduleAccess) {
        throw new HttpException({success:false, message:'Module access denied.', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.FORBIDDEN);
      }

      if (accessControlList[action]) {
        const permissions = accessControlList[action];
        const hasAccess = permissions.some(
          (permission: string) => moduleAccess[permission],
        );

        if (!hasAccess) {
          throw new HttpException(
            `Access denied for ${action}.`,
            HttpStatus.FORBIDDEN,
          );
        }
      } else {
        throw new HttpException({success:false, message:'Invalid action.', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.FORBIDDEN);
      }

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException({success:false, message:'Invalid token.', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.UNAUTHORIZED);
    }
  }
}