import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { AddModuleService } from './add-module.service';
import { CreateModuleDto } from './create-module.dto';
import { Collection, Document } from 'mongodb';

interface BasicModuleDocument extends Document {
  _id: string;
  data: {
    form: any;
  };
}

@Injectable()
export class CreateModuleService {
  constructor(
    private readonly mongoDBService: DatabaseService,
    private readonly addModuleService: AddModuleService,
  ) {}

  async createModuleByBuildHANA(appName: string, { _id, moduleName }: CreateModuleDto, token: string) {
    if (!_id || !moduleName || !token) {
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Required fields (_id, moduleName, token) are missing',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const mainDb = this.mongoDBService.getDB('hana');
    const basicModulesCollection: Collection<BasicModuleDocument> = mainDb.collection('basicModules');

    const moduleData = await basicModulesCollection.findOne({ _id });
    if (!moduleData) {
      throw new HttpException(
        {
          status: false,
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Module not found in basicModules collection',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const formJson = moduleData.data.form;
    const listPath = `/list/${moduleName.toLowerCase()}`;
    const dashTitle = `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} Dashboard`;
    const listTitle = `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} List`;
    const addTitle = `Add ${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}`;
    const editTitle = `Edit ${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}`;
    const sidebarLabel = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    const sidebarIcon = "<i class='fa fa-list'></i>";
    const customFields = {
      displayType: ['table'],
    };
    const onlyDashboard = false;
    const dashJson = [];

    await this.addModuleService.addModule(
      {
        appName,
        moduleName,
        listPath,
        dashTitle,
        listTitle,
        addTitle,
        editTitle,
        sidebarLabel,
        sidebarIcon,
        customFields,
        formJson,
        dashJson,
        onlyDashboard,
      },
      token,
    );
  }
}