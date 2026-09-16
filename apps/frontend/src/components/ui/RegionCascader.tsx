/* 省/市/县区/乡镇 四级行政区划级联选择（数据源 china-division）
 * - 值为中文名（与库表一致）；乡镇数据约 4MB，按需动态加载（Vite 分包，选中市/县区后才拉取）
 * - 直筒子市（东莞等）无区级：过滤与市同名的占位条目后区级为空，市后直接选乡镇 */
import { useEffect, useMemo, useState } from "react";
import { SelectField } from "./Field";
import provincesJson from "china-division/dist/provinces.json";
import citiesJson from "china-division/dist/cities.json";
import areasJson from "china-division/dist/areas.json";

export interface RegionValue {
    province: string;
    city: string;
    district: string;
    town: string;
}

interface Division {
    code: string;
    name: string;
    provinceCode?: string;
    cityCode?: string;
    areaCode?: string;
}

const provinces = provincesJson as Division[];
const cities = citiesJson as Division[];
const areas = areasJson as Division[];

let streetsPromise: Promise<Division[]> | null = null;
const loadStreets = () => {
    streetsPromise ??= import("china-division/dist/streets.json").then(module => module.default as Division[]);
    return streetsPromise;
};

export function RegionCascader({
    value,
    onChange,
    error,
}: {
    value: RegionValue;
    onChange: (next: RegionValue) => void;
    error?: string;
}) {
    const province = provinces.find(item => item.name === value.province);
    const cityList = useMemo(() => cities.filter(item => item.provinceCode === province?.code), [province?.code]);
    const city = cityList.find(item => item.name === value.city);
    // 直筒子市（东莞等）的区级占位条目与市同名，过滤后区级为空、直接选乡镇
    const districtList = useMemo(
        () => areas.filter(item => item.cityCode === city?.code && item.name !== city?.name),
        [city?.code, city?.name],
    );
    const district = districtList.find(item => item.name === value.district);
    const noDistrictCity = !!city && districtList.length === 0;

    // 乡镇列表：常规城市按县区挂载；直筒子市直接挂在市下
    const streetScope = district?.code ?? (noDistrictCity ? city?.code : undefined);
    const [streets, setStreets] = useState<Division[] | null>(null);
    useEffect(() => {
        if (!streetScope) return;
        let cancelled = false;
        loadStreets().then(all => {
            if (!cancelled) setStreets(all);
        });
        return () => {
            cancelled = true;
        };
    }, [streetScope]);
    const townList = useMemo(() => {
        if (!streets) return [];
        if (district) return streets.filter(item => item.areaCode === district.code);
        if (noDistrictCity && city) return streets.filter(item => item.cityCode === city.code);
        return [];
    }, [streets, district, noDistrictCity, city]);

    const pick = (patch: Partial<RegionValue>, clear: Array<"city" | "district" | "town">) => {
        const next = { ...value, ...patch };
        clear.forEach(key => {
            next[key] = "";
        });
        onChange(next);
    };

    return (
        <>
            <SelectField
                label="省 / 直辖市"
                error={error}
                value={value.province}
                onChange={event => pick({ province: event.target.value }, ["city", "district", "town"])}
            >
                <option value="">请选择省份（可空）</option>
                {provinces.map(item => (
                    <option key={item.code}>{item.name}</option>
                ))}
            </SelectField>
            <SelectField
                label="市"
                disabled={!province}
                value={value.city}
                onChange={event => pick({ city: event.target.value }, ["district", "town"])}
            >
                <option value="">{province ? "请选择城市" : "请先选择省份"}</option>
                {cityList.map(item => (
                    <option key={item.code}>{item.name}</option>
                ))}
            </SelectField>
            <SelectField
                label="县 / 区"
                disabled={!city || districtList.length === 0}
                value={value.district}
                onChange={event => pick({ district: event.target.value }, ["town"])}
            >
                <option value="">{city && districtList.length === 0 ? "无区级（市直管乡镇）" : "请选择县区"}</option>
                {districtList.map(item => (
                    <option key={item.code}>{item.name}</option>
                ))}
            </SelectField>
            <SelectField
                label="乡镇 / 街道"
                disabled={!streetScope}
                value={value.town}
                onChange={event => onChange({ ...value, town: event.target.value })}
            >
                <option value="">
                    {!streetScope ? "请先选择市/县区" : streets ? "请选择乡镇（可空）" : "乡镇数据加载中…"}
                </option>
                {townList.map(item => (
                    <option key={item.code}>{item.name}</option>
                ))}
            </SelectField>
        </>
    );
}
