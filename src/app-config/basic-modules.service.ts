import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { GetBasicModulesDto } from './get-basic-modules.dto';

@Injectable()
export class BasicModulesService {
  constructor(private readonly mongoDBService: DatabaseService) {}

  async getBasicModules(appName: string, { limit = 30, skip = 0, filter = '' }: GetBasicModulesDto) {
    const lowercaseFilter = filter.toLowerCase();
    const query = {
      $or: [
        {
          $expr: {
            $regexMatch: {
              input: { $toLower: '$name' },
              regex: lowercaseFilter,
            },
          },
        },
        { tags: { $elemMatch: { $regex: lowercaseFilter, $options: 'i' } } },
      ],
    };

    const mainDb = this.mongoDBService.getDB('hana');
    const collection = mainDb.collection('basicModules');

    const documents = await collection
      .find(query)
      .skip(skip)
      .limit(limit)
      .toArray();

    const data = documents.map((doc, index) => ({
      _id: doc._id,
      id: index + 1,
      name: doc.name,
      tags: doc.tags,
      doc: doc.doc,
    }));

    const count = documents.length || limit;
    const totalCount = await collection.countDocuments(query);

    return { data, count, totalCount };
  }
}