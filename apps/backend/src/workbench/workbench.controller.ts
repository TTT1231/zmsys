import { Controller, Get } from "@nestjs/common";
import { AuthenticatedOnly } from "../common/decorators/authenticated-only.decorator";
import { WorkbenchService } from "./workbench.service";

/** 工作台经营总览：登录即可访问（各角色公共首页）。 */
@Controller("workbench")
export class WorkbenchController {
    constructor(private readonly workbench: WorkbenchService) {}

    @AuthenticatedOnly()
    @Get("overview")
    getOverview() {
        return this.workbench.getOverview();
    }
}
