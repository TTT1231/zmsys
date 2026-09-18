/** 契约 Customer（openapi customers tag）：手机号仅掩码；合作状态由订单派生不落库 */
export interface Customer {
    version: number;
    code: string;
    name: string;
    contact: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    town: string;
    address: string;
    cooperation: "合作中" | "待跟进";
    owner: string;
    ownerAccount: string;
    payTerms: string;
    created: string;
}

/** 契约 CustomerOwnerOption：客户负责人候选，仅展示字段，不暴露用户管理信息 */
export interface CustomerOwnerOption {
    name: string;
    account: string;
}
