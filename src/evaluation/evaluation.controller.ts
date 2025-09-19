import { Controller, Post, Body, Req, BadRequestException } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import type { Request } from 'express';

@Controller('api')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post('evaluation/percentage')
  async fetchModuleData(@Req() req: Request, @Body() body: any) {
    const key = req.headers['x-api-key'];
    if (!key) throw new BadRequestException("API key is required in headers");
    if (!body.appName) throw new BadRequestException("appName is required in body");
    if (!body.moduleName) throw new BadRequestException("moduleName is required in body");
    if (!body.evaluationId) throw new BadRequestException("evaluationId is required in body");

    return this.evaluationService.getFieldStatisticsForEvaluation(

      key as string,
      body.appName,
      body.moduleName,
      body.evaluationId,
    );
  }
}
