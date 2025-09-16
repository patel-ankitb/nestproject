import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class EvaluationService {
  private connections: Map<string, Connection> = new Map();
  private readonly BASE_URI =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';

  // ===== Connection Pool =====
  private async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) return this.connections.get(cacheKey)!;
    const connection = await mongoose.createConnection(cn_str, { dbName }).asPromise();
    this.connections.set(cacheKey, connection);
    return connection;
  }

  private async getDbConfigFromKey(key: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
    const config = await configConn.collection('appconfigs').findOne({
      'sectionData.appconfigs.key': key,
    });

    if (!config?.sectionData?.appconfigs?.db) {
      throw new BadRequestException(`No database found for key '${key}'`);
    }

    return {
      db: config.sectionData.appconfigs.db,
      modules: config.sectionData.appconfigs.modules || [],
    };
  }

  private async getModuleByName(key: string, moduleName: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
    const config = await configConn.collection('appconfigs').findOne({
      'sectionData.appconfigs.key': key,
    });

    if (!config?.sectionData?.appconfigs?.modules) {
      throw new BadRequestException(`Modules not found for key '${key}'`);
    }

    const cleanModuleName = moduleName.trim();
    const moduleObj = config.sectionData.appconfigs.modules.find((m: any) => {
      if (typeof m === 'string') return m.trim() === cleanModuleName;
      if (m && typeof m === 'object') {
        const names = [m.moduleName, m.name, m.module]
          .filter(Boolean)
          .map((n: string) => n.trim());
        return names.includes(cleanModuleName);
      }
      return false;
    });

    if (!moduleObj) {
      throw new BadRequestException(
        `Module '${cleanModuleName}' not found for key '${key}'`,
      );
    }

    return moduleObj;
  }

  // ===== Main Logic =====
  async getFieldStatisticsAndSave(key: string, appName: string, moduleName: string) {
    // Get database name
    const { db } = await this.getDbConfigFromKey(key);

    // Get module config
    const moduleObj = await this.getModuleByName(key, moduleName);
    console.log('Fetched moduleObj:', moduleObj);

    if (!moduleObj) {
      throw new BadRequestException(`Module '${moduleName}' not found`);
    }

    console.log(
      'Module Object:',
      moduleObj,
      moduleObj.sectionData,
      moduleObj.data,
      moduleObj.config,
    );

    // Extract sectionData
    const sectionData =
      moduleObj.sectionData ||
      moduleObj.data?.sectionData ||
      moduleObj.config?.sectionData ||
      {};

    if (!sectionData || Object.keys(sectionData).length === 0) {
      throw new BadRequestException(
        `Module '${moduleName}' has no sectionData`,
      );
    }

    // Find evaluation section
    const evalSectionKey = Object.keys(sectionData).find(
      (k) => sectionData[k]?.field,
    );
    if (!evalSectionKey) {
      throw new BadRequestException(
        `Module '${moduleName}' does not have evaluation configuration`,
      );
    }

    const evalConfig = sectionData[evalSectionKey];
    const fieldName = evalConfig.field;
    const options = evalConfig.name || [];

    if (!fieldName) {
      throw new BadRequestException(
        `Invalid evaluation configuration in module '${moduleName}'`,
      );
    }

    const sectionKey = evalSectionKey.toLowerCase();

    // Connect to target DB
    const connection = await this.getConnection(this.BASE_URI, db);

    // Aggregation pipeline
    const pipeline = [
      {
        $match: {
          [`sectionData.${sectionKey}.${fieldName}`]: {
            $exists: true,
            $ne: null,
          },
        },
      },
      {
        $group: {
          _id: `$sectionData.${sectionKey}.${fieldName}`,
          count: { $sum: 1 },
        },
      },
    ];

    const result = await connection
      .collection('evaluation')
      .aggregate(pipeline)
      .toArray();

    const total = result.reduce((acc, curr) => acc + curr.count, 0);

    const formattedResult = options.map((opt: any) => {
      const match = result.find((r) => r._id === opt.option);
      const count = match ? match.count : 0;
      const percent =
        total > 0 ? ((count / total) * 100).toFixed(2) : '0.00';
      return {
        option: opt.option,
        count,
        percentage: percent + '%',
      };
    });

    const statsDoc = {
      moduleName,
      section: sectionKey,
      field: fieldName,
      total,
      results: formattedResult,
      createdAt: new Date(),
    };

    await connection.collection('evaluationstats').insertOne(statsDoc);

    return statsDoc;
  }
}
