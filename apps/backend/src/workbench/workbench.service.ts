import { Injectable, NotImplementedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../configuration";
import { beijingToday, createWorkbenchDemo } from "./workbench.demo";

/** 工作台聚合读模型。真实库聚合查询尚未接入：MOCK_ENABLED=true 返回演示数据，
 * 否则 501（生产环境 configuration 已禁止开启 mock）。 */
@Injectable()
export class WorkbenchService {
    constructor(private readonly config: ConfigService<AppConfig>) {}

    getOverview() {
        if (!this.config.get("workbench.mockEnabled", { infer: true })) {
            throw new NotImplementedException("workbench 真实聚合尚未接入：设 MOCK_ENABLED=true 获取演示数据");
        }
        return createWorkbenchDemo(beijingToday());
    }
}
