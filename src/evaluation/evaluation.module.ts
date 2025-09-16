import { Module } from "@nestjs/common";
import { EvaluationController } from "./evaluation.controller";
import { EvaluationService } from "./evaluation.service";
import { DatabaseService } from "src/databases/database.service";

@Module({
    imports: [],
    controllers: [EvaluationController],
    providers: [EvaluationService, DatabaseService]
})


export class EvaluationModule {}