import { fetchJson } from "./fetcher";

export type Weather = {
  current: {
    time: string;
    temp: number;
    feels: number;
    humidity: number;
    precip: number;
    code: number;
    windSpeed: number;
    windDir: number;
    pressure: number;
    isDay: boolean;
  };
  hourly: { time: string; temp: number; pop: number; code: number }[];
  daily: { date: string; code: number; max: number; min: number; pop: number }[];
};

type OpenMeteo = {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    pressure_msl: number;
    is_day: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
};

export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Tokyo",
    wind_speed_unit: "ms",
    forecast_days: "7",
  });
  const d = await fetchJson<OpenMeteo>(`https://api.open-meteo.com/v1/forecast?${params}`);
  const nowIdx = Math.max(0, d.hourly.time.findIndex((t) => t >= d.current.time.slice(0, 13)));
  return {
    current: {
      time: d.current.time,
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      precip: d.current.precipitation,
      code: d.current.weather_code,
      windSpeed: d.current.wind_speed_10m,
      windDir: d.current.wind_direction_10m,
      pressure: d.current.pressure_msl,
      isDay: d.current.is_day === 1,
    },
    hourly: d.hourly.time.slice(nowIdx, nowIdx + 24).map((t, i) => ({
      time: t,
      temp: d.hourly.temperature_2m[nowIdx + i],
      pop: d.hourly.precipitation_probability[nowIdx + i],
      code: d.hourly.weather_code[nowIdx + i],
    })),
    daily: d.daily.time.map((t, i) => ({
      date: t,
      code: d.daily.weather_code[i],
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      pop: d.daily.precipitation_probability_max[i],
    })),
  };
}

// WMO 天気コード → 表示
export function weatherInfo(code: number, isDay = true): { label: string; icon: string } {
  if (code === 0) return { label: "快晴", icon: isDay ? "☀️" : "🌙" };
  if (code === 1) return { label: "晴れ", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { label: "晴れ時々曇り", icon: "⛅" };
  if (code === 3) return { label: "曇り", icon: "☁️" };
  if (code === 45 || code === 48) return { label: "霧", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "霧雨", icon: "🌦️" };
  if (code >= 61 && code <= 67) return { label: code >= 65 ? "強い雨" : "雨", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "雪", icon: "🌨️" };
  if (code >= 80 && code <= 82) return { label: "にわか雨", icon: "🌦️" };
  if (code === 85 || code === 86) return { label: "にわか雪", icon: "🌨️" };
  if (code >= 95) return { label: "雷雨", icon: "⛈️" };
  return { label: "—", icon: "❔" };
}

const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
export const windDirLabel = (deg: number) => DIRS[Math.round(deg / 22.5) % 16];
