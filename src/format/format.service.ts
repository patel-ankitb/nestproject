

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
    if ( rawPrice === 'string') {
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
// ===== CASE 1: newvarinet =====
if (moduleName === 'newvarinet') {
  const newVariantDocs = await collection.find({}).toArray();
  const updates: any[] = [];

  for (const variant of newVariantDocs) {
    const modelId = variant?.sectionData?.newVariants?.modelId;
    if (!modelId) continue;

    // ===== maxPower parsing =====
    const maxPowerStr =
      variant?.sectionData?.newVariants?.details?.specifications?.maxPower || 'N/A';

    let minBhp: number | null = null;
    let maxBhp: number | null = null;
    let minPowerRpm: number | null = null;
    let maxPowerRpm: number | null = null;

    let maxPowerBhpFormatted: string = 'N/A';
    let maxPowerRpmFormatted: string = 'N/A';

    if (maxPowerStr && maxPowerStr.toLowerCase() !== 'n/a') {
      const [bhpPart, rpmPart] = maxPowerStr.split('@').map(p => p.trim());

      // Parse BHP
      if (bhpPart) {
        const bhpNumbers = bhpPart.replace(/bhp/gi, '').split('-').map(p => parseFloat(p.trim()));
        if (bhpNumbers.length === 1) minBhp = maxBhp = bhpNumbers[0];
        else if (bhpNumbers.length === 2) {
          minBhp = Math.min(bhpNumbers[0], bhpNumbers[1]);
          maxBhp = Math.max(bhpNumbers[0], bhpNumbers[1]);
        }
        if (minBhp !== null && maxBhp !== null)
          maxPowerBhpFormatted = `${minBhp}-${maxBhp} bhp`;
      }

      // Parse RPM
      if (rpmPart) {
        const rpmNumbers = rpmPart.replace(/rpm/gi, '').split('-').map(p => parseFloat(p.trim()));
        if (rpmNumbers.length === 1) minPowerRpm = maxPowerRpm = rpmNumbers[0];
        else if (rpmNumbers.length === 2) {
          minPowerRpm = Math.min(rpmNumbers[0], rpmNumbers[1]);
          maxPowerRpm = Math.max(rpmNumbers[0], rpmNumbers[1]);
        }
        if (minPowerRpm !== null && maxPowerRpm !== null)
          maxPowerRpmFormatted = `${minPowerRpm}-${maxPowerRpm} rpm`;
      }
    }

    // ===== maxTorque parsing =====
    const maxTorqueStr =
      variant?.sectionData?.newVariants?.details?.specifications?.maxTorque || 'N/A';

    let minTorqueNm: number | null = null;
    let maxTorqueNm: number | null = null;
    let minTorqueRpm: number | null = null;
    let maxTorqueRpm: number | null = null;

    let maxTorqueNmFormatted: string = 'N/A';
    let maxTorqueRpmFormatted: string = 'N/A';

    if (maxTorqueStr && maxTorqueStr.toLowerCase() !== 'n/a') {
      const [nmPart, rpmPart] = maxTorqueStr.split('@').map(p => p.trim());

      // Parse Nm
      if (nmPart) {
        const nmNumbers = nmPart.replace(/nm/gi, '').split('-').map(p => parseFloat(p.trim()));
        if (nmNumbers.length === 1) minTorqueNm = maxTorqueNm = nmNumbers[0];
        else if (nmNumbers.length === 2) {
          minTorqueNm = Math.min(nmNumbers[0], nmNumbers[1]);
          maxTorqueNm = Math.max(nmNumbers[0], nmNumbers[1]);
        }
        if (minTorqueNm !== null && maxTorqueNm !== null)
          maxTorqueNmFormatted = `${minTorqueNm}-${maxTorqueNm} Nm`;
      }

      // Parse RPM
      if (rpmPart) {
        const rpmNumbers = rpmPart.replace(/rpm/gi, '').split('-').map(p => parseFloat(p.trim()));
        if (rpmNumbers.length === 1) minTorqueRpm = maxTorqueRpm = rpmNumbers[0];
        else if (rpmNumbers.length === 2) {
          minTorqueRpm = Math.min(rpmNumbers[0], rpmNumbers[1]);
          maxTorqueRpm = Math.max(rpmNumbers[0], rpmNumbers[1]);
        }
        if (minTorqueRpm !== null && maxTorqueRpm !== null)
          maxTorqueRpmFormatted = `${minTorqueRpm}-${maxTorqueRpm} rpm`;
      }
    }

    // ===== Prepare newcarData =====
    const newcarData = {
      mileageARAI: variant?.sectionData?.newVariants?.details?.specifications?.mileageARAI || 'N/A',
      seatingCapacity: variant?.sectionData?.newVariants?.details?.features?.seatingCapacity || 'N/A',
      fuelType: variant?.sectionData?.newVariants?.fuelType || 'N/A',
      maxPower: variant?.sectionData?.newVariants?.details?.specifications?.maxPower || 'N/A', // untouched
      maxPowerBhp: maxPowerBhpFormatted,   // new field
      maxPowerRpm: maxPowerRpmFormatted,   // new field
      maxTorqueNm: maxTorqueNmFormatted,   // new field
      maxTorqueRpm: maxTorqueRpmFormatted, // new field
      bodyType: variant?.sectionData?.newVariants?.details?.features?.bodyType || 'N/A',
    };

    // Build dot-notation update dynamically
    const updateFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(newcarData)) {
      updateFields[`sectionData.newModel.${k}`] = v;
    }
    updateFields['updatedAt'] = new Date();

    await db.collection('format').updateOne(
      { _id: modelId },
      { $set: updateFields },
    );

    updates.push({ modelId, newcarData });
  }

  return {
    success: true,
    moduleName,
    appName,
    updatedCount: updates.length,
    updatedModels: updates,
  };
}

await db.collection('format').updateMany(
  {
    'sectionData.newModel.price': { 
      $ne: null, 
      $not: { $regex: '^N/A$', $options: 'i' } // Exclude "N/A"
    }
  },
  [
    // Step 1 – Normalize hyphens
    {
      $set: {
        priceNormalized: {
          $replaceAll: {
            input: { $toString: '$sectionData.newModel.price' },
            find: '–',
            replacement: '-'
          }
        }
      }
    },
    // Step 2 – Split into min and max
    {
      $set: {
        minRaw: { $arrayElemAt: [{ $split: ['$priceNormalized', '-'] }, 0] },
        maxRaw: { $arrayElemAt: [{ $split: ['$priceNormalized', '-'] }, 1] }
      }
    },
    // Step 3 – Clean extra symbols and spaces
    {
      $set: {
        minClean: {
          $trim: {
            input: {
              $replaceAll: { input: '$minRaw', find: '₹', replacement: '' }
            },
            chars: ' '
          }
        },
        maxClean: {
          $trim: {
            input: {
              $replaceAll: { input: '$maxRaw', find: '₹', replacement: '' }
            },
            chars: ' '
          }
        }
      }
    },
    // Step 4 – Convert min and max to numeric values
    {
      $set: {
        'sectionData.newModel.minPrice': {
          $cond: [
            { $regexMatch: { input: '$minClean', regex: /^(\d+(\.\d+)?)$/ } },
            { $toInt: { $toDouble: '$minClean' } },
            {
              $cond: [
                { $regexMatch: { input: '$minClean', regex: /lakh/i } },
                {
                  $toInt: {
                    $multiply: [
                      { $toDouble: { $trim: { input: { $replaceAll: { input: '$minClean', find: 'Lakh', replacement: '' } }, chars: ' ' } } },
                      100000
                    ]
                  }
                },
                {
                  $cond: [
                    { $regexMatch: { input: '$minClean', regex: /crore/i } },
                    {
                      $toInt: {
                        $multiply: [
                          { $toDouble: { $trim: { input: { $replaceAll: { input: '$minClean', find: 'Crore', replacement: '' } }, chars: ' ' } } },
                          10000000
                        ]
                      }
                    },
                    null
                  ]
                }
              ]
            }
          ]
        },
        'sectionData.newModel.maxPrice': {
          $cond: [
            { $regexMatch: { input: '$maxClean', regex: /^(\d+(\.\d+)?)$/ } },
            { $toInt: { $toDouble: '$maxClean' } },
            {
              $cond: [
                { $regexMatch: { input: '$maxClean', regex: /lakh/i } },
                {
                  $toInt: {
                    $multiply: [
                      { $toDouble: { $trim: { input: { $replaceAll: { input: '$maxClean', find: 'Lakh', replacement: '' } }, chars: ' ' } } },
                      100000
                    ]
                  }
                },
                {
                  $cond: [
                    { $regexMatch: { input: '$maxClean', regex: /crore/i } },
                    {
                      $toInt: {
                        $multiply: [
                          { $toDouble: { $trim: { input: { $replaceAll: { input: '$maxClean', find: 'Crore', replacement: '' } }, chars: ' ' } } },
                          10000000
                        ]
                      }
                    },
                    null
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    // Step 5 – Remove temporary fields
    {
      $unset: ['priceNormalized', 'minRaw', 'maxRaw', 'minClean', 'maxClean']
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
