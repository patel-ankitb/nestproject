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
    const action =
      req.method === 'POST' && (req.path.includes('basic-modules') || req.path.includes('create-module'))
        ? 'create-module'
        : req.method === 'POST'
        ? 'save-config'
        : 'get-config';
    const { appName } = req.params;
    const moduleName = req.query.moduleName as string || 'basicModule';
    const token = req.headers.authorization;

    if (!token) {
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Token is required.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    try {
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
      if (!role) {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Role not found.',
          },
          HttpStatus.FORBIDDEN,
        );
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
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Module access denied.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (accessControlList[action]) {
        const permissions = accessControlList[action];
        const hasAccess = permissions.some(
          (permission: string) => moduleAccess[permission],
        );

        if (!hasAccess) {
          throw new HttpException(
            {
              status: false,
              statusCode: HttpStatus.FORBIDDEN,
              message: `Access denied for ${action}.`,
            },
            HttpStatus.FORBIDDEN,
          );
        }
      } else {
        throw new HttpException(
          {
            status: false,
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Invalid action.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Invalid token.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}