import type { Interface } from "node:readline/promises";
import {
  christmasMarketPrompt,
  cityBreakPrompt,
  cultureTripPrompt,
  skiingHolidayPrompt,
  winterSunPrompt,
} from "./prompt-ref.js";

// Response types for https://www.weatherapi.com/docs/realtime-api/
// (the docs show no sample JSON, so the nesting of `location`, `current` and
// `condition` is inferred from the field tables).
export type WeatherApiLocation = {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  tz_id: string;
  localtime_epoch: number;
  localtime: string;
};

export type WeatherApiCurrent = {
  last_updated: string;
  last_updated_epoch: number;
  temp_c: number;
  temp_f: number;
  is_day: 0 | 1;
  condition: { text: string; icon: string; code: number };
  wind_mph: number;
  wind_kph: number;
  wind_degree: number;
  wind_dir: string;
  pressure_mb: number;
  pressure_in: number;
  precip_mm: number;
  precip_in: number;
  humidity: number;
  cloud: number;
  feelslike_c: number;
  feelslike_f: number;
  windchill_c: number;
  windchill_f: number;
  heatindex_c: number;
  heatindex_f: number;
  dewpoint_c: number;
  dewpoint_f: number;
  uv: number;
  gust_mph: number;
  gust_kph: number;
  // Paid plans only
  short_rad?: number;
  diff_rad?: number;
  dni?: number;
  gti?: number;
  pollen?: unknown;
  // Only present when the request uses aqi=yes (getWeather sends aqi=no)
  air_quality?: {
    co: number;
    o3: number;
    no2: number;
    so2: number;
    pm2_5: number;
    pm10: number;
    "us-epa-index": number;
    "gb-defra-index": number;
  };
};

export type WeatherApiCurrentResponse = {
  location: WeatherApiLocation;
  current: WeatherApiCurrent;
};

export const getWeather = async (
  location: string,
  country: string,
): Promise<WeatherApiCurrentResponse> => {
  const query = `${location}, ${country}`;
  const response = await fetch(
    `https://api.weatherapi.com/v1/current.json?q=${encodeURIComponent(query)}&aqi=no&key=${process.env.WEATHER_API_KEY}`,
  );
  if (!response.ok) {
    throw new Error(
      `Weather API error: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as WeatherApiCurrentResponse;
};

export type TimePeriod = "days" | "weeks" | "months" | "years";

export const addTimePeriod = (
  date: Date,
  amount: number,
  unit: TimePeriod,
): Date => {
  // Clone the date so the original is not modified
  const result = new Date(date.getTime());

  switch (unit) {
    case "days":
      result.setDate(result.getDate() + amount);
      break;
    case "weeks":
      result.setDate(result.getDate() + amount * 7);
      break;
    case "months":
      result.setMonth(result.getMonth() + amount);
      break;
    case "years":
      result.setFullYear(result.getFullYear() + amount);
      break;
  }

  return result;
};

const HOLIDAY_OPTIONS = [
  { label: "Christmas market", prompt: christmasMarketPrompt },
  { label: "Winter sun", prompt: winterSunPrompt },
  { label: "Skiing holiday", prompt: skiingHolidayPrompt },
  { label: "Culture trip", prompt: cultureTripPrompt },
  { label: "City break", prompt: cityBreakPrompt },
  { label: "Other (you specify)", prompt: null },
];

export const askHolidayPrompt = async (rl: Interface): Promise<string> => {
  console.log("What type of holiday are you looking for?");
  HOLIDAY_OPTIONS.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));

  while (true) {
    const answer = (await rl.question("Choose a number: ")).trim();
    const option = HOLIDAY_OPTIONS[Number(answer) - 1];
    if (!option) {
      console.log(`Please enter a number from 1 to ${HOLIDAY_OPTIONS.length}.`);
      continue;
    }
    if (option.prompt) return option.prompt;

    const custom = (await rl.question("Describe the holiday you want: ")).trim();
    if (custom) return custom;
  }
};
