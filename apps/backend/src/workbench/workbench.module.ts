import { Module } from "@nestjs/common";
import { WorkbenchController } from "./workbench.controller";
import { WorkbenchService } from "./workbench.service";
import { RelationsService } from "./relations.service";

@Module({
    controllers: [WorkbenchController],
    providers: [WorkbenchService, RelationsService],
})
export class WorkbenchModule {}
