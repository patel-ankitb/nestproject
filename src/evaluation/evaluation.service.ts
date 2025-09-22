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

    const normalizeName = (name: string) => name?.trim().toLowerCase();

    // 1. Evaluation doc
    const evaluationDoc = await connection
      .collection<{ _id: string; sectionData: any }>('evaluation')
      .findOne({ _id: evaluationId }, { projection: { _id: 1, sectionData: 1 } });

    if (!evaluationDoc) {
      throw new BadRequestException(
        `Evaluation not found with id '${evaluationId}' in db '${db}'`,
      );
    }

    // 2. Master fields
    const masterDocs = await connection
      .collection('evaluationmaster')
      .find({}, { projection: { sectionData: 1 } })
      .toArray();

    const sectionFilledCounts: Record<string, number> = {};
    const sectionTotalCounts: Record<string, number> = {};

    // 3. Loop and count
    for (const masterDoc of masterDocs) {
      const evalField = masterDoc.sectionData?.Evaluation;
      if (!evalField) continue;

      const sectionNameRaw = evalField.mainlabel?.trim();
      const fieldKey = evalField.field?.trim();
      if (!sectionNameRaw || !fieldKey) continue;

      const sectionKey = normalizeName(sectionNameRaw);

      if (!sectionTotalCounts[sectionKey]) sectionTotalCounts[sectionKey] = 0;
      if (!sectionFilledCounts[sectionKey]) sectionFilledCounts[sectionKey] = 0;

      sectionTotalCounts[sectionKey]++;

      const sectionObj =
        evaluationDoc.sectionData?.[sectionNameRaw] ??
        evaluationDoc.sectionData?.[sectionNameRaw.toLowerCase()] ??
        evaluationDoc.sectionData?.[sectionNameRaw.toUpperCase()];

      const value =
        sectionObj?.[fieldKey] ??
        sectionObj?.[fieldKey.toLowerCase()] ??
        sectionObj?.[fieldKey.toUpperCase()];

      const isFilled =
        value !== null &&
        value !== undefined &&
        !(typeof value === 'string' && value.trim() === '') &&
        (!(Array.isArray(value)) || value.length > 0) &&
        (typeof value !== 'object' || Object.keys(value || {}).length > 0);

      if (isFilled) sectionFilledCounts[sectionKey]++;
    }

    // 4. Predefined sequence
    const predefinedOrder = [
      "Car Condition",
      "Car Details",
      "Body",
      "Tyre",
      "Interior",
      "Engine",
      "Suspension",
      "Brakes",
      "Transmission",
      "Electrical",
      "Miscellaneous",
      "AC Compressor",
      "Battery",
      "Remarks",
    ];

    const sections = predefinedOrder.map((sectionName, idx) => {
      const sectionKey = normalizeName(sectionName);
      const total = sectionTotalCounts[sectionKey] || 0;
      const filled = sectionFilledCounts[sectionKey] || 0;
      const percentage = total > 0 ? parseFloat(((filled / total) * 100).toFixed(2)) : 0;
      const id = idx + 1;

      return {
        id,
        name: sectionName,
        percentage,
      };
    });

    return {
      moduleName,
      evaluationId,
      sections,
      createdAt: new Date(),
    };
  }
}
