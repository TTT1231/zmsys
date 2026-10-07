import { Controller, Get } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { WorkbenchService } from "./workbench.service";

/** 工作台经营总览：菜单级权限 `menu:workbench`，与授权里的「工作台」开关一致。 */
@Controller("workbench")
export class WorkbenchController {
    constructor(private readonly workbench: WorkbenchService) {}

    @Permissions([PERMISSIONS.MENU_WORKBENCH], "无权查看工作台")
    @Get("overview")
    getOverview() {
        return this.workbench.getOverview();
    }
}
