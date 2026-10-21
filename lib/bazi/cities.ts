/**
 * Interim city list for the birth-place dropdown.
 *
 * Replaced in T4 by a GeoNames-backed lookup. Until then this covers the
 * cities most likely to come up in testing and demos; anything else goes
 * through the manual-coordinates path, which is why that path exists.
 *
 * Coordinates are city-centre approximations — good to well under the ~1° that
 * would shift true solar time by four minutes.
 */

export interface CityOption {
  id: string;
  country_code: string;
  country: string;
  city: string;
  latitude: number;
  longitude: number;
}

export const CITY_OPTIONS: CityOption[] = [
  { id: "sg-singapore", country_code: "SG", country: "新加坡", city: "新加坡", latitude: 1.3521, longitude: 103.8198 },
  { id: "cn-beijing", country_code: "CN", country: "中国", city: "北京", latitude: 39.9042, longitude: 116.4074 },
  { id: "cn-shanghai", country_code: "CN", country: "中国", city: "上海", latitude: 31.2304, longitude: 121.4737 },
  { id: "cn-guangzhou", country_code: "CN", country: "中国", city: "广州", latitude: 23.1291, longitude: 113.2644 },
  { id: "cn-shenzhen", country_code: "CN", country: "中国", city: "深圳", latitude: 22.5431, longitude: 114.0579 },
  { id: "cn-chengdu", country_code: "CN", country: "中国", city: "成都", latitude: 30.5728, longitude: 104.0668 },
  { id: "cn-xian", country_code: "CN", country: "中国", city: "西安", latitude: 34.3416, longitude: 108.9398 },
  { id: "cn-harbin", country_code: "CN", country: "中国", city: "哈尔滨", latitude: 45.8038, longitude: 126.5349 },
  { id: "cn-urumqi", country_code: "CN", country: "中国", city: "乌鲁木齐", latitude: 43.8256, longitude: 87.6168 },
  { id: "hk-hongkong", country_code: "HK", country: "中国香港", city: "香港", latitude: 22.3193, longitude: 114.1694 },
  { id: "tw-taipei", country_code: "TW", country: "中国台湾", city: "台北", latitude: 25.033, longitude: 121.5654 },
  { id: "my-kualalumpur", country_code: "MY", country: "马来西亚", city: "吉隆坡", latitude: 3.139, longitude: 101.6869 },
  { id: "jp-tokyo", country_code: "JP", country: "日本", city: "东京", latitude: 35.6762, longitude: 139.6503 },
  { id: "kr-seoul", country_code: "KR", country: "韩国", city: "首尔", latitude: 37.5665, longitude: 126.978 },
  { id: "th-bangkok", country_code: "TH", country: "泰国", city: "曼谷", latitude: 13.7563, longitude: 100.5018 },
  { id: "gb-london", country_code: "GB", country: "英国", city: "伦敦", latitude: 51.5074, longitude: -0.1278 },
  { id: "us-newyork", country_code: "US", country: "美国", city: "纽约", latitude: 40.7128, longitude: -74.006 },
  { id: "us-sanfrancisco", country_code: "US", country: "美国", city: "旧金山", latitude: 37.7749, longitude: -122.4194 },
  { id: "au-sydney", country_code: "AU", country: "澳大利亚", city: "悉尼", latitude: -33.8688, longitude: 151.2093 },
];
