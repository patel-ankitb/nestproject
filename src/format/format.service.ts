

// format.service.ts
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

    // Optional preview for newModel price
    let minPrice: string | null = null;
    let maxPrice: string | null = null;

    const rawPrice = config?.sectionData?.newModel?.price ?? null;
    if (typeof rawPrice === 'string' && rawPrice.trim() !== '') {
      const normalized = rawPrice
        .replace(/–/g, '-') // en dash → hyphen
        .replace(/₹/g, '')
        .replace(/Lakh/gi, ' Lakh')
        .replace(/Crore/gi, ' Crore')
        .trim();

      const parts = normalized.split('-').map((p) => p.trim());
      minPrice = parts[0] || null;
      if (parts.length > 1) maxPrice = parts[1] || null;
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

    //---- new varinet special handling ----
if (moduleName === 'newvarinet') {
  const newVariantDocs = await collection.find({}).toArray();

  // Group variants by modelId
  const grouped: Record<string, any[]> = {};
  for (const variant of newVariantDocs) {
    const modelId = variant?.sectionData?.newVariants?.modelId as string;
    if (!modelId) continue;
    if (!grouped[modelId]) grouped[modelId] = [];
    grouped[modelId].push(variant);
  }

  const updates: any[] = [];

  for (const [modelId, variants] of Object.entries(grouped)) {
    let minBhp: number | null = null;
    let maxBhp: number | null = null;
    let minPowerRpm: number | null = null;
    let maxPowerRpm: number | null = null;
    let minTorqueNm: number | null = null;
    let maxTorqueNm: number | null = null;
    let minTorqueRpm: number | null = null;
    let maxTorqueRpm: number | null = null;

    // Additional fields
    let fuelType: string | null = null;
    let bodyType: string | null = null;
    let seatingCapacity: string | null = null;
    let mileage: string | null = null;
    let transmissions: Set<string> = new Set();

    for (const variant of variants) {
      // ===== maxPower parsing =====
      const maxPowerStr =
        variant?.sectionData?.newVariants?.details?.specifications?.maxPower || 'N/A';
      if (maxPowerStr && maxPowerStr.toLowerCase() !== 'n/a') {
        const [bhpPart, rpmPart] = maxPowerStr.split('@').map(p => p.trim());
        if (bhpPart) {
          const bhpNumbers = bhpPart.replace(/bhp/gi, '').split('-').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
          if (bhpNumbers.length >= 1) {
            const localMinBhp = Math.min(...bhpNumbers);
            const localMaxBhp = bhpNumbers.length === 1 ? localMinBhp : Math.max(...bhpNumbers);
            minBhp = minBhp === null ? localMinBhp : Math.min(minBhp, localMinBhp);
            maxBhp = maxBhp === null ? localMaxBhp : Math.max(maxBhp, localMaxBhp);
          }
        }
        if (rpmPart) {
          const rpmNumbers = rpmPart.replace(/rpm/gi, '').split('-').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
          if (rpmNumbers.length >= 1) {
            const localMinRpm = Math.min(...rpmNumbers);
            const localMaxRpm = rpmNumbers.length === 1 ? localMinRpm : Math.max(...rpmNumbers);
            minPowerRpm = minPowerRpm === null ? localMinRpm : Math.min(minPowerRpm, localMinRpm);
            maxPowerRpm = maxPowerRpm === null ? localMaxRpm : Math.max(maxPowerRpm, localMaxRpm);
          }
        }
      }

      // ===== maxTorque parsing =====
      const maxTorqueStr =
        variant?.sectionData?.newVariants?.details?.specifications?.maxTorque || 'N/A';
      if (maxTorqueStr && maxTorqueStr.toLowerCase() !== 'n/a') {
        const [nmPart, rpmPart] = maxTorqueStr.split('@').map(p => p.trim());
        if (nmPart) {
          const nmNumbers = nmPart.replace(/nm/gi, '').split('-').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
          if (nmNumbers.length >= 1) {
            const localMinNm = Math.min(...nmNumbers);
            const localMaxNm = nmNumbers.length === 1 ? localMinNm : Math.max(...nmNumbers);
            minTorqueNm = minTorqueNm === null ? localMinNm : Math.min(minTorqueNm, localMinNm);
            maxTorqueNm = maxTorqueNm === null ? localMaxNm : Math.max(maxTorqueNm, localMaxNm);
          }
        }
        if (rpmPart) {
          const rpmNumbers = rpmPart.replace(/rpm/gi, '').split('-').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
          if (rpmNumbers.length >= 1) {
            const localMinRpm = Math.min(...rpmNumbers);
            const localMaxRpm = rpmNumbers.length === 1 ? localMinRpm : Math.max(...rpmNumbers);
            minTorqueRpm = minTorqueRpm === null ? localMinRpm : Math.min(minTorqueRpm, localMinRpm);
            maxTorqueRpm = maxTorqueRpm === null ? localMaxRpm : Math.max(maxTorqueRpm, localMaxRpm);
          }
        }
      }

      // ===== Collect additional fields =====
      if (!fuelType) {
        const ft = variant?.sectionData?.newVariants?.details?.specifications?.fuelType;
        if (ft != null) {
          const ftStr = String(ft).trim();
          if (ftStr && ftStr.toLowerCase() !== 'n/a') {
            fuelType = ftStr;
          }
        }
      }

      if (!bodyType) {
        const bt = variant?.sectionData?.newVariants?.details?.specifications?.bodyType;
        if (bt != null) {
          const btStr = String(bt).trim();
          if (btStr && btStr.toLowerCase() !== 'n/a') {
            bodyType = btStr;
          }
        }
      }

      if (!seatingCapacity) {
        const sc = variant?.sectionData?.newVariants?.details?.features?.seatingCapacity;
        if (sc != null) {
          const scStrRaw = String(sc).trim();
          let scStr = scStrRaw;
          const numMatch = scStrRaw.match(/\d+/);
          if (numMatch) {
            scStr = numMatch[0];
          }
          if (scStr && scStr.toLowerCase() !== 'n/a') {
            seatingCapacity = scStr;
          }
        }
      }

      if (!mileage) {
        const mi = variant?.sectionData?.newVariants?.details?.specifications?.mileage;
        if (mi != null) {
          const miStr = String(mi).trim();
          if (miStr && miStr.toLowerCase() !== 'n/a') {
            mileage = miStr;
          }
        }
      }

    // ===== Collect transmissions =====
const trans = variant?.sectionData?.newVariants?.details?.specifications?.transmission;
if (trans != null) {
  const transStr = String(trans).trim();
  if (transStr && transStr.toLowerCase() !== 'n/a') {
    // Only allow "Manual" and "AMT"
    const normalized = transStr.toLowerCase();
    if (normalized.includes('manual')) {
      transmissions.add('Manual');
    } else if (normalized.includes('amt')) {
      transmissions.add('AMT');
    }
  }
}
    }
    // Format results
    const maxPowerBhpFormatted = (minBhp !== null && maxBhp !== null)
      ? (minBhp === maxBhp ? `${minBhp}` : `${minBhp}-${maxBhp}`)
      : 'N/A';

    const maxPowerRpmFormatted = (minPowerRpm !== null && maxPowerRpm !== null)
      ? (minPowerRpm === maxPowerRpm ? `${minPowerRpm}` : `${minPowerRpm}-${maxPowerRpm}`)
      : 'N/A';

    const maxTorqueNmFormatted = (minTorqueNm !== null && maxTorqueNm !== null)
      ? (minTorqueNm === maxTorqueNm ? `${minTorqueNm}` : `${minTorqueNm}-${maxTorqueNm}`)
      : 'N/A';

    const maxTorqueRpmFormatted = (minTorqueRpm !== null && maxTorqueRpm !== null)
      ? (minTorqueRpm === maxTorqueRpm ? `${minTorqueRpm}` : `${minTorqueRpm}-${maxTorqueRpm}`)
      : 'N/A';

    const transmissionArray = Array.from(transmissions);

    // Update 'format' collection using string _id
    const formatId: any = mongoose.Types.ObjectId.isValid(modelId)
      ? new mongoose.Types.ObjectId(modelId)
      : modelId;

    await db.collection('format').updateOne(
      { _id: formatId },
      {
        $set: {
          'sectionData.newModel.PowerBhp': maxPowerBhpFormatted,
          'sectionData.newModel.PowerRpm': maxPowerRpmFormatted,
          'sectionData.newModel.TorqueNm': maxTorqueNmFormatted,
          'sectionData.newModel.TorqueRpm': maxTorqueRpmFormatted,
          'sectionData.newModel.fuelType': fuelType ?? 'N/A',
          'sectionData.newModel.bodyType': bodyType ?? 'N/A',
          'sectionData.newModel.seatingCapacity': seatingCapacity ?? 'N/A',
          'sectionData.newModel.mileage': mileage ?? 'N/A',
          'sectionData.newModel.transmission': transmissionArray,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    updates.push({
      modelId,
      PowerBhp: maxPowerBhpFormatted,
      PowerRpm: maxPowerRpmFormatted,
      TorqueNm: maxTorqueNmFormatted,
      TorqueRpm: maxTorqueRpmFormatted,
      fuelType: fuelType ?? 'N/A',
      bodyType: bodyType ?? 'N/A',
      seatingCapacity: seatingCapacity ?? 'N/A',
      mileage: mileage ?? 'N/A',
      transmission: transmissionArray
    });
  }

  return {
    success: true,
    moduleName,
    appName,
    updatedCount: updates.length,
    updatedModels: updates
  };
}

// ====== Normalize price and convert companyId ======
await db.collection('format').updateMany(
  {
    'sectionData.newModel.price': {
      $ne: null,
      $not: { $regex: '^N/A$', $options: 'i' }
    }
  },
  [
    // normalize hyphen
    {
      $set: {
        priceNormalized: {
          $replaceAll: {
            input: { $toString: '$sectionData.newModel.price' },
            find: '–',
            replacement: '-'
          }
        },
        // ✅ Convert companyId to string
        companyId: { $toString: '$companyId' }
      }
    },
    // split into minRaw / maxRaw
    {
      $set: {
        minRaw: { $arrayElemAt: [{ $split: ['$priceNormalized', '-'] }, 0] },
        maxRaw: { $arrayElemAt: [{ $split: ['$priceNormalized', '-'] }, 1] }
      }
    },
    // clean ₹ and whitespace, detect unit if present on min or max
    {
      $set: {
        minClean: {
          $trim: {
            input: { $replaceAll: { input: '$minRaw', find: '₹', replacement: '' } },
            chars: ' '
          }
        },
        maxClean: {
          $trim: {
            input: { $replaceAll: { input: '$maxRaw', find: '₹', replacement: '' } },
            chars: ' '
          }
        },
        unitDetected: {
          $cond: [
            { $regexMatch: { input: '$minRaw', regex: /lakh/i } }, 'lakh',
            {
              $cond: [
                { $regexMatch: { input: '$minRaw', regex: /crore/i } }, 'crore',
                {
                  $cond: [
                    { $regexMatch: { input: '$maxRaw', regex: /lakh/i } }, 'lakh',
                    {
                      $cond: [
                        { $regexMatch: { input: '$maxRaw', regex: /crore/i } }, 'crore',
                        null
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    // compute minPrice and maxPrice as STRING of full rupee number
    {
      $set: {
        'sectionData.newModel.minPrice': {
          $let: {
            vars: {
              numeric: {
                $toDouble: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $replaceAll: { input: '$minClean', find: 'Lakh', replacement: '' } },
                        find: 'Crore',
                        replacement: ''
                      }
                    },
                    chars: ' '
                  }
                }
              },
              multiplier: {
                $switch: {
                  branches: [
                    { case: { $regexMatch: { input: '$minClean', regex: /lakh/i } }, then: 100000 },
                    { case: { $regexMatch: { input: '$minClean', regex: /crore/i } }, then: 10000000 },
                    { case: { $eq: ['$unitDetected', 'lakh'] }, then: 100000 },
                    { case: { $eq: ['$unitDetected', 'crore'] }, then: 10000000 }
                  ],
                  default: 1
                }
              }
            },
            in: {
              $toString: { $toInt: { $multiply: ['$$numeric', '$$multiplier'] } }
            }
          }
        },

        'sectionData.newModel.maxPrice': {
          $let: {
            vars: {
              numeric: {
                $toDouble: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $replaceAll: { input: '$maxClean', find: 'Lakh', replacement: '' } },
                        find: 'Crore',
                        replacement: ''
                      }
                    },
                    chars: ' '
                  }
                }
              },
              multiplier: {
                $switch: {
                  branches: [
                    { case: { $regexMatch: { input: '$maxClean', regex: /lakh/i } }, then: 100000 },
                    { case: { $regexMatch: { input: '$maxClean', regex: /crore/i } }, then: 10000000 },
                    { case: { $eq: ['$unitDetected', 'lakh'] }, then: 100000 },
                    { case: { $eq: ['$unitDetected', 'crore'] }, then: 10000000 }
                  ],
                  default: 1
                }
              }
            },
            in: { $toString: { $toInt: { $multiply: ['$$numeric', '$$multiplier'] } } }
          }
        }
      }
    },
    // cleanup temporaries
    {
      $unset: ['priceNormalized', 'minRaw', 'maxRaw', 'minClean', 'maxClean', 'unitDetected']
    }
  ]
);



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
  newModelMinPrice: config.newModelMinPrice ? config.newModelMinPrice.toString() : null,
  newModelMaxPrice: config.newModelMaxPrice ? config.newModelMaxPrice.toString() : null,
  //minPrice: minValue !== null ? minValue.toString() : null,
  minPrice: minValue !== null ? JSON.stringify(minValue) : null,
  maxPrice: maxValue !== null ? maxValue.toString() : null,
};
  }
}
