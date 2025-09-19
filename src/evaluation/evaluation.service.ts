import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service';

@Injectable()
export class EvaluationService {
  constructor(private readonly dbService: DatabaseService) {}

  async getFieldStatisticsForEvaluation(
    key: string,
    appName: string,
    moduleName: string,
    evaluationId: string,
  ) {
    const { db } = await this.dbService.getDbConfigFromKey(key);
    const connection = await this.dbService.getConnection(
      process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
      db,
    );

    // 1. Get evaluation document by ID
    const evaluationDoc = await connection
      .collection<{ _id: string; sectionData: any }>('evaluation')
      .findOne({ _id: evaluationId }, { projection: { _id: 1, sectionData: 1 } });

    if (!evaluationDoc) {
      throw new BadRequestException(
        `Evaluation not found with id '${evaluationId}' in db '${db}'`,
      );
    }

    // 2. Get master field definitions
    const masterDocs = await connection
      .collection('evaluationmaster')
      .find({}, { projection: { sectionData: 1 } })
      .toArray();

    const sectionFilledCounts: Record<string, number> = {};
    const sectionTotalCounts: Record<string, number> = {};

    // 3. Loop over master definitions
    for (const masterDoc of masterDocs) {
      const evalField = masterDoc.sectionData?.Evaluation;
      if (!evalField) continue;

      const sectionName = evalField.mainlabel?.trim();
      const fieldKey = evalField.field?.trim();
      if (!sectionName || !fieldKey) continue;

      // init counters
      if (!sectionTotalCounts[sectionName]) sectionTotalCounts[sectionName] = 0;
      if (!sectionFilledCounts[sectionName]) sectionFilledCounts[sectionName] = 0;

      sectionTotalCounts[sectionName]++;

      // === Case-insensitive matching ===
      const sectionObj =
        evaluationDoc.sectionData?.[sectionName] ??
        evaluationDoc.sectionData?.[sectionName.toLowerCase()] ??
        evaluationDoc.sectionData?.[sectionName.toUpperCase()];

      const value =
        sectionObj?.[fieldKey] ??
        sectionObj?.[fieldKey.toLowerCase()] ??
        sectionObj?.[fieldKey.toUpperCase()];

      // === Filled check ===
      const isFilled =
        value !== null &&
        value !== undefined &&
        !(typeof value === 'string' && value.trim() === '') &&
        (!(Array.isArray(value)) || value.length > 0) &&
        (typeof value !== 'object' || Object.keys(value || {}).length > 0);

      if (isFilled) {
        sectionFilledCounts[sectionName]++;
      }

      // Debug log (optional)
      // console.log({ sectionName, fieldKey, value, isFilled });
    }

    // 4. Calculate percentages
    const sectionPercentages = Object.keys(sectionTotalCounts).map((sectionName) => {
      const total = sectionTotalCounts[sectionName];
      const filled = sectionFilledCounts[sectionName] || 0;
      const percentage = total > 0 ? parseFloat(((filled / total) * 100).toFixed(2)) : 0;

      return { name: sectionName, percentage };
    });

    return {
      moduleName,
      evaluationId,
      sectionPercentages,
      createdAt: new Date(),
    };
  }
}
