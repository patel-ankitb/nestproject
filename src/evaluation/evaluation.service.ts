import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service';

@Injectable()
export class EvaluationService {
  constructor(private readonly dbService: DatabaseService) {}

  async getFieldStatisticsForAllFields(
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

    const evaluationDocs = await connection
      .collection<{ _id: string; sectionData: any }>('evaluation')
      .find({}, { projection: { _id: 1, sectionData: 1 } })
      .toArray();

    if (!evaluationDocs || evaluationDocs.length === 0) {
      throw new BadRequestException(`No evaluation records found in db '${db}'`);
    }

    const sectionFilledCounts: Record<string, number> = {};
    const sectionTotalCounts: Record<string, number> = {};

    for (const doc of evaluationDocs) {
      const sectionData = doc.sectionData;
      if (!sectionData || typeof sectionData !== 'object') continue;

      for (const sectionKey of Object.keys(sectionData)) {
        const obj = sectionData[sectionKey];
        if (!obj || typeof obj !== 'object') continue;

        if (!sectionFilledCounts[sectionKey]) sectionFilledCounts[sectionKey] = 0;
        if (!sectionTotalCounts[sectionKey]) sectionTotalCounts[sectionKey] = 0;

        for (const field in obj) {
          sectionTotalCounts[sectionKey] += 1;

          const value = obj[field];
          const isFilled =
            value !== null &&
            value !== '' &&
            value !== undefined &&
            (!(Array.isArray(value)) || value.length > 0);

          if (isFilled) {
            sectionFilledCounts[sectionKey] += 1;
          }
        }
      }
    }

    const sectionPercentages: { name: string; percentage: number }[] = [];

    for (const sectionKey of Object.keys(sectionTotalCounts)) {
      // Skip unwanted sections
      if (['evaluation', 'rating parts'].includes(sectionKey)) continue;

      const total = sectionTotalCounts[sectionKey];
      const filled = sectionFilledCounts[sectionKey] || 0;
      const percentage =
        total > 0
          ? parseFloat(((filled / total) * 100).toFixed(2))
          : 0;

      sectionPercentages.push({
        name: sectionKey,
        percentage,
      });
    }

    return {
      moduleName,
      evaluationId,
      sectionPercentages,
      createdAt: new Date(),
    };
  }
}
