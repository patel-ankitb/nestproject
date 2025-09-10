import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class FormatService {
  private connections: Map<string, Connection> = new Map();
  private readonly BASE_URI =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';

  // ===== Connection Pool =====
  private async getConnection(
    cn_str: string,
    dbName: string,
  ): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) return this.connections.get(cacheKey)!;
    const connection = await mongoose
      .createConnection(cn_str, { dbName })
      .asPromise();
    this.connections.set(cacheKey, connection);
    return connection;
  }

  // ===== Get DB Config =====
  private async getDbConfigFromKey(key: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
    const config = await configConn.collection('appconfigs').findOne({
      'sectionData.appconfigs.key': key,
    });

    if (!config) {
      throw new BadRequestException(`No config found for key '${key}'`);
    }
    if (!config?.sectionData?.appconfigs?.db) {
      throw new BadRequestException(`No database found for key '${key}'`);
    }

    // Extract single price min/max from config (optional preview)
    let minPrice: number | null = null;
    let maxPrice: number | null = null;

    const rawPrice = config?.sectionData?.newModel?.price ?? null;
    if (rawPrice && typeof rawPrice === 'string') {
      const normalized = rawPrice
        .replace(/–/g, '-') // en dash → hyphen
        .replace(/₹/g, '')
        .replace(/Lakh/gi, ' Lakh')
        .replace(/Crore/gi, ' Crore')
        .trim();

      const parts = normalized.split('-').map((p) => p.trim());

      const parseVal = (val: string): number | null => {
        if (!val) return null;
        let num = parseFloat(val.replace(/[^\d.]/g, ''));
        if (isNaN(num)) return null;
        if (/Crore/i.test(val)) return num * 10000000;
        if (/Lakh/i.test(val)) return num * 100000;
        return num;
      };

      minPrice = parseVal(parts[0]);
      if (parts.length > 1) maxPrice = parseVal(parts[1]);
    }

    return {
      db: config.sectionData.appconfigs.db,
      modules: config.sectionData.appconfigs.modules || [],
      newModelMinPrice: minPrice,
      newModelMaxPrice: maxPrice,
    };
  }

  // ===== Main Entry =====
  async getModuleData(headers: any, body: any) {
    const { moduleName, appName, query = {}, projection = {} } = body;

    if (!moduleName) throw new BadRequestException('moduleName is required');
    if (!appName) throw new BadRequestException('appName is required');

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException('x-api-key header is required');

    // ===== DB connection =====
    const config = await this.getDbConfigFromKey(key);
    const conn = await this.getConnection(this.BASE_URI, config.db);
    const db = conn.db;
    if (!db) throw new BadRequestException('Database connection failed');

    // ensure collection exists
    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === moduleName)) {
      throw new BadRequestException(`Collection '${moduleName}' not found`);
    }
    const collection = db.collection(moduleName);

    // ===== STEP 1: Normalize and update min/max price for each document =====
    await collection.updateMany(
      { 'sectionData.newModel.price': { $ne: null } },
      [
        {
          $set: {
            priceNormalized: {
              $replaceAll: {
                input: { $toString: '$sectionData.newModel.price' },
                find: '–',
                replacement: '-',
              },
            },
          },
        },
        {
          $set: {
            minRaw: {
              $arrayElemAt: [{ $split: ['$priceNormalized', '-'] }, 0],
            },
            maxRaw: {
              $arrayElemAt: [{ $split: ['$priceNormalized', '-'] }, 1],
            },
          },
        },
        {
          $set: {
            'sectionData.newModel.minPrice': {
              $cond: [
                {
                  $regexMatch: { input: '$minRaw', regex: 'Crore', options: 'i' },
                },
                {
                  $multiply: [
                    {
                      $convert: {
                        input: {
                          $trim: {
                            input: {
                              $replaceAll: {
                                input: {
                                  $replaceAll: {
                                    input: '$minRaw',
                                    find: '₹',
                                    replacement: '',
                                  },
                                },
                                find: 'Crore',
                                replacement: '',
                              },
                            },
                            chars: ' ',
                          },
                        },
                        to: 'double',
                        onError: null,
                        onNull: null,
                      },
                    },
                    10000000,
                  ],
                },
                {
                  $multiply: [
                    {
                      $convert: {
                        input: {
                          $trim: {
                            input: {
                              $replaceAll: {
                                input: {
                                  $replaceAll: {
                                    input: '$minRaw',
                                    find: '₹',
                                    replacement: '',
                                  },
                                },
                                find: 'Lakh',
                                replacement: '',
                              },
                            },
                            chars: ' ',
                          },
                        },
                        to: 'double',
                        onError: null,
                        onNull: null,
                      },
                    },
                    100000,
                  ],
                },
              ],
            },
            'sectionData.newModel.maxPrice': {
              $cond: [
                {
                  $regexMatch: { input: '$maxRaw', regex: 'Crore', options: 'i' },
                },
                {
                  $multiply: [
                    {
                      $convert: {
                        input: {
                          $trim: {
                            input: {
                              $replaceAll: {
                                input: {
                                  $replaceAll: {
                                    input: '$maxRaw',
                                    find: '₹',
                                    replacement: '',
                                  },
                                },
                                find: 'Crore',
                                replacement: '',
                              },
                            },
                            chars: ' ',
                          },
                        },
                        to: 'double',
                        onError: null,
                        onNull: null,
                      },
                    },
                    10000000,
                  ],
                },
                {
                  $multiply: [
                    {
                      $convert: {
                        input: {
                          $trim: {
                            input: {
                              $replaceAll: {
                                input: {
                                  $replaceAll: {
                                    input: '$maxRaw',
                                    find: '₹',
                                    replacement: '',
                                  },
                                },
                                find: 'Lakh',
                                replacement: '',
                              },
                            },
                            chars: ' ',
                          },
                        },
                        to: 'double',
                        onError: null,
                        onNull: null,
                      },
                    },
                    100000,
                  ],
                },
              ],
            },
          },
        },
        { $unset: ['priceNormalized', 'minRaw', 'maxRaw'] },
      ],
    );

    // ===== STEP 2: Aggregate collection-wide min/max =====
    const pipeline: any[] = [];
    if (Object.keys(query).length) pipeline.push({ $match: query });
    if (Object.keys(projection).length) pipeline.push({ $project: projection });

    pipeline.push({
      $match: {
        'sectionData.newModel.minPrice': { $ne: null },
        'sectionData.newModel.maxPrice': { $ne: null },
      },
    });

    pipeline.push({
      $group: {
        _id: null,
        minValue: { $min: '$sectionData.newModel.minPrice' },
        maxValue: { $max: '$sectionData.newModel.maxPrice' },
      },
    });

    const result = await collection.aggregate(pipeline).toArray();
    const minValue = result[0]?.minValue ?? null;
    const maxValue = result[0]?.maxValue ?? null;

    return {
      success: true,
      moduleName,
      appName,
      newModelMinPrice: config.newModelMinPrice,
      newModelMaxPrice: config.newModelMaxPrice,
      minPrice: minValue,
      maxPrice: maxValue,
    };
  }
}
