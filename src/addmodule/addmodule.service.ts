import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { MongoClient } from 'mongodb';

@Injectable()
export class AddModuleService {
  private readonly mongoUri = process.env.MONGO_URI || '';
  private readonly client = new MongoClient(this.mongoUri);

  // ✅ Simple user access check (stub)
  private async checkUserAccess(userId: string, moduleName: string): Promise<boolean> {
    return !!userId; // allow if userId exists
  }

  // ✅ Log errors to console (no Redis, no email)
  private async logError(error: any): Promise<void> {
    console.error('Error in AddModuleService:', error?.stack || error?.message || error);
  }

  async addModule(req: any, res: any) {
    const {
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
    } = req.body;

    const userId = req.headers.authorization || 'unknown-user';

    if (
      !appName ||
      !moduleName ||
      (!onlyDashboard &&
        (!listPath || !listTitle || !addTitle || !editTitle || !formJson)) ||
      (onlyDashboard && !dashJson)
    ) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided',
      });
    }

    try {
      await this.client.connect();
      const db = this.client.db(appName); // appName is DB name
      const schemaCollection = db.collection('schema');

      // ✅ Check access
      const hasAccess = await this.checkUserAccess(userId, moduleName);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'User does not have access',
        });
      }

      // ✅ Generate module ID
      const moduleId = new Date().getTime().toString();
      const schemaCode = `${moduleName.toUpperCase()}_SCHEMA`;
      const fModName = moduleName.toLowerCase();

      const capitalizeFirstLetter = (str: string) =>
        str.charAt(0).toUpperCase() + str.slice(1);

      const fSidebarLabel = sidebarLabel || capitalizeFirstLetter(moduleName);

      const schema = {
        _id: moduleId,
        code: schemaCode,
        name: fModName,
        collectionToSubmit: fModName,
        ...customFields,
        dash: typeof dashJson === 'string' ? JSON.parse(dashJson) : dashJson,
        form: typeof formJson === 'string' ? JSON.parse(formJson) : formJson,
      };

      await schemaCollection.insertOne(schema);

      // ✅ Routes configuration
      const routes: { type: string; title: string }[] = [];
      if (dashJson) {
        routes.push({
          type: 'dash',
          title: dashTitle || `${capitalizeFirstLetter(moduleName)} Dashboard`,
        });
      }
      if (!onlyDashboard) {
        routes.push(
          { type: 'list', title: listTitle },
          { type: 'form-add', title: addTitle },
          { type: 'form-edit', title: editTitle },
        );
      }

      const routesConfig = await schemaCollection.findOne({ code: 'ROUTES_CONFIG' });
      if (routesConfig) {
        await schemaCollection.updateOne(
          { code: 'ROUTES_CONFIG' },
          { $push: { modules: { module_name: fModName, routes } } },
        );
      }

      // ✅ Sidebar configuration
      if (!onlyDashboard) {
        const sidebarConfig = await schemaCollection.findOne({ code: 'SIDEBAR_CONFIG' });
        if (sidebarConfig) {
          await schemaCollection.updateOne(
            { code: 'SIDEBAR_CONFIG' },
            {
              $push: {
                'data.links': {
                  path: listPath,
                  label: fSidebarLabel,
                  icon: sidebarIcon || "<i class='fa fa-list'></i>",
                  mdl_nm: fModName,
                },
              },
            },
          );
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Module, routes, and sidebar added successfully',
      });
    } catch (error) {
      await this.logError(error);
      return res.status(500).json({
        success: false,
        message: `Error adding module: ${error.message}`,
      });
    } finally {
      await this.client.close();
    }
  }
}
