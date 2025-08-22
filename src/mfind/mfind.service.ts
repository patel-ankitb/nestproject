import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

@Injectable()
export class MFindService {
  private readonly JWT_SECRET = 'myStaticSecretKey'; // 🔑 Secret for JWT
  private readonly STATIC_USER = {
    username: 'admin',   // 🔒 Static username
    password: 'admin1234' // 🔒 Static password
  };

  // ---------------- LOGIN ----------------
  async login(body: any) {
    const { username, password } = body;

    // ✅ Validate static username & password
    if (username !== this.STATIC_USER.username || password !== this.STATIC_USER.password) {
      throw new UnauthorizedException('Invalid username or password');
    }

    // ✅ Generate JWT
    const payload = { username };
    const token = jwt.sign(payload, this.JWT_SECRET, { expiresIn: '1h' });
    return { access_token: token };
  }

  // ---------------- VERIFY TOKEN ----------------
  verifyToken(authHeader: string | undefined) {
    // Check if Authorization header exists
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    // Normalize header to handle case-insensitive keys
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Authorization header must start with "Bearer "');
    }

    const token = authHeader.slice(7).trim(); // Remove 'Bearer ' prefix and trim whitespace
    if (!token) {
      throw new UnauthorizedException('Token is missing in Authorization header');
    }

    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      console.log('Decoded token:', decoded); // Add logging for debugging
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException('Invalid token: ' + error.message);
      } else {
        throw new UnauthorizedException('Token verification failed');
      }
    }
  }

  
    
  async runAggregation(body: any, headers: any) {
    // ✅ Check token before running query
    const authHeader = Object.keys(headers).find(
      (key) => key.toLowerCase() === 'authorization'
    );
    
    const token = authHeader ? headers[authHeader] : undefined;
    
    // If no token provided, return error message
    if (!token || token.trim() === '') {
      return { 
        error: true, 
        message: 'Authorization token is required', 
        data: [] 
      };
    }
    
    // Verify token validity
    try {
      await this.verifyToken(token);
    } catch (error) {
      return { 
        error: true, 
        message: 'Invalid or expired authorization token', 
        data: [] 
      };
    }

    const {
      appName,
      moduleName,
      query = {},
      projection = {},
      limit = 10,
      skip = 0,
      order = 'descending',
      sortBy = '_id',
      lookups = [],
      companyId,
      tableType,
    } = body;

    if (!appName || !moduleName) {
      return { 
        error: true, 
        message: 'appName and moduleName are required', 
        data: [] 
      };
    }

    // Validate query and projection are objects
    if (typeof query !== 'object' || query === null) {
      return { 
        error: true, 
        message: 'query must be a valid object', 
        data: [] 
      };
    }
    if (typeof projection !== 'object' || projection === null) {
      return { 
        error: true, 
        message: 'projection must be a valid object', 
        data: [] 
      };
    }
    if (!Array.isArray(lookups)) {
      return { 
        error: true, 
        message: 'lookups must be an array', 
        data: [] 
      };
    }

    try {
      // ✅ Get DB connection
      const connection = mongoose.connection.useDb(appName);

      if (!connection.db) {
        return { 
          error: true, 
          message: 'Database connection is not available', 
          data: [] 
        };
      }

      const collections = await connection.db.listCollections().toArray();
      const collectionExists = collections.some((col) => col.name === moduleName);
      if (!collectionExists) {
        return { 
          error: true, 
          message: `Collection ${moduleName} does not exist`, 
          data: [] 
        };
      }

      const collection = connection.collection(moduleName);

      // ✅ Build aggregation pipeline
      const pipeline: any[] = [{ $match: query }];

      if (lookups.length > 0) {
        for (const lookup of lookups) {
          if (!lookup || !lookup.$lookup || !lookup.$lookup.from) {
            return { 
              error: true, 
              message: 'Invalid lookup configuration', 
              data: [] 
            };
          }
          const lookupCollection = lookup.$lookup.from;
          const exists = collections.some((col) => col.name === lookupCollection);
          if (exists) pipeline.push({ $lookup: lookup.$lookup });
        }
      }

      if (Object.keys(projection).length > 0) {
        pipeline.push({ $project: projection });
      }

      pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });
      pipeline.push({ $skip: Number(skip) });
      pipeline.push({ $limit: Number(limit) });

      if (companyId) {
        pipeline.push({ $match: { companyId } });
      } else {
        pipeline.push({ $match: { companyId: { $exists: false } } });
      }

      pipeline.push({ $addFields: { tableType: tableType || 'default' } });

      // ✅ Execute aggregation and log for debugging
      console.log('Aggregation pipeline:', pipeline);
      const result = await collection.aggregate(pipeline).toArray();
      console.log('Aggregation result:', result);

      if (result.length === 0) {
        return { 
          error: false, 
          message: 'No data found', 
          data: [] 
        };
      }

      return { 
        error: false, 
        message: 'Data retrieved successfully', 
        data: result 
      };

    } catch (error) {
      console.error('Error in runAggregation:', error);
      return { 
        error: true, 
        message: 'Internal server error occurred', 
        data: [] 
      };
    }
  }
}