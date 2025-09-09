import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class formatService {
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

  private async getDbConfigFromKey(key: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
    const config = await configConn.collection('appconfigs').findOne({
      'sectionData.appconfigs.key': key,
    });

    if (!config) {
      console.error('Config not found for key:', key);
      throw new BadRequestException(`No config found for key '${key}'`);
    }
    if (!config?.sectionData?.appconfigs?.db) {
      console.error('DB not found in config:', config);
      throw new BadRequestException(`No database found for key '${key}'`);
    }

// ===== Extract min & max from sectionData.newModel.price =====
let minPrice: number | null = null;
let maxPrice: number | null = null;

const rawPrice = config?.sectionData?.newModel?.price ?? null;
console.log('Raw price from config:', rawPrice);

if (rawPrice && typeof rawPrice === 'string') {
  const normalized = rawPrice
    .toString()
    .replace(/–/g, '-')         // replace en dash with hyphen
    .replace(/₹/g, '')          // remove ₹
    .replace(/Lakh/gi, '')      // remove "Lakh"
    .replace(/Crore/gi, '*100') // mark Crore for scaling later
    .trim();

  const parts = normalized.split('-').map((p) => p.trim());

  if (parts.length) {
    // parse first number
    minPrice = parseFloat(parts[0]) || null;
    // parse second number
    if (parts.length > 1) {
      maxPrice = parseFloat(parts[1]) || null;
    }
  }

  // Scale if "Crore" found
  if (/Crore/i.test(rawPrice)) {
    if (minPrice) minPrice = minPrice * 100;
    if (maxPrice) maxPrice = maxPrice * 100;
  }
} else {
  console.warn('No price found in config.sectionData.newModel');
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
    const {
      moduleName,
      appName,
      query = {},
      projection = {},
    } = body;

    if (!moduleName) throw new BadRequestException('moduleName is required');
    if (!appName) throw new BadRequestException('appName is required');

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException('x-api-key header is required');

    // ===== DB connection =====
    const config = await this.getDbConfigFromKey(key);
    console.log('Config fetched for getModuleData:', config);
    const conn = await this.getConnection(this.BASE_URI, config.db);
    const db = conn.db;
    if (!db) throw new BadRequestException('Database connection failed');

    // ensure collection exists
    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === moduleName)) {
      throw new BadRequestException(`Collection '${moduleName}' not found`);
    }
    const collection = db.collection(moduleName);
await collection.updateMany(
  { "sectionData.newModel.price": { $ne: null } },
  [
    {
      $set: {
        priceNormalized: {
          $replaceAll: {
            input: { $toString: "$sectionData.newModel.price" },
            find: "–",
            replacement: "-"
          }
        }
      }
    },
    {
      $set: {
        minRaw: {
          $arrayElemAt: [{ $split: ["$priceNormalized", "-"] }, 0]
        },
        maxRaw: {
          $arrayElemAt: [{ $split: ["$priceNormalized", "-"] }, 1]
        }
      }
    },
    {
      $set: {
        "sectionData.newModel.minPrice": {
          $toString: {
            $cond: [
              { $regexMatch: { input: "$minRaw", regex: "Crore", options: "i" } },
              {
                $multiply: [
                  {
                    $convert: {
                      input: {
                        $trim: {
                          input: {
                            $replaceAll: {
                              input: {
                                $replaceAll: { input: "$minRaw", find: "₹", replacement: "" }
                              },
                              find: "Crore",
                              replacement: ""
                            }
                          },
                          chars: " "
                        }
                      },
                      to: "double",
                      onError: 0,
                      onNull: 0
                    }
                  },
                  10000000 // ✅ 1 Crore = 10,000,000
                ]
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
                                $replaceAll: { input: "$minRaw", find: "₹", replacement: "" }
                              },
                              find: "Lakh",
                              replacement: ""
                            }
                          },
                          chars: " "
                        }
                      },
                      to: "double",
                      onError: 0,
                      onNull: 0
                    }
                  },
                  100000 // ✅ 1 Lakh = 100,000
                ]
              }
            ]
          }
        },
        "sectionData.newModel.maxPrice": {
          $toString: {
            $cond: [
              { $regexMatch: { input: "$maxRaw", regex: "Crore", options: "i" } },
              {
                $multiply: [
                  {
                    $convert: {
                      input: {
                        $trim: {
                          input: {
                            $replaceAll: {
                              input: {
                                $replaceAll: { input: "$maxRaw", find: "₹", replacement: "" }
                              },
                              find: "Crore",
                              replacement: ""
                            }
                          },
                          chars: " "
                        }
                      },
                      to: "double",
                      onError: 0,
                      onNull: 0
                    }
                  },
                  10000000 // ✅ 1 Crore = 10,000,000
                ]
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
                                $replaceAll: { input: "$maxRaw", find: "₹", replacement: "" }
                              },
                              find: "Lakh",
                              replacement: ""
                            }
                          },
                          chars: " "
                        }
                      },
                      to: "double",
                      onError: 0,
                      onNull: 0
                    }
                  },
                  100000 // ✅ 1 Lakh = 100,000
                ]
              }
            ]
          }
        }
      }
    },
    { $unset: ["priceNormalized", "minRaw", "maxRaw"] }
  ]
);


    // ===== STEP 2: Aggregate collection-wide min and max =====
    const pipeline: any[] = [];
    if (Object.keys(query).length) pipeline.push({ $match: query });
    if (Object.keys(projection).length) pipeline.push({ $project: projection });

    pipeline.push({ $match: { minPrice: { $ne: null }, maxPrice: { $ne: null } } });

    pipeline.push({
      $group: {
        _id: null,
        minValue: { $min: '$minPrice' },
        maxValue: { $max: '$maxPrice' },
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