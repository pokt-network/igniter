import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const UPOKT_CONSTANT = 1e6;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const roundAndSeparate = (
  value: number,
  decimalPlaces = 4,
  defaultValue: string | number = "-"
) => {
  return value
    ? parseFloat(value.toFixed(decimalPlaces)).toLocaleString('en-US', {
        maximumFractionDigits: decimalPlaces,
      })
    : (defaultValue as string);
};

export const getRandomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

export function getShortAddress(address: string, length = 8) {
  return address && address.length
    ? address.replace('pokt', '').slice(0, length) + "..." + address.slice(-length)
    : "";
}

export function toCurrencyFormat(
  value: number,
  maxFractionDigits = 2,
  minimumFractionDigits = 0
) {
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: minimumFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function toCompactFormat(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

export function amountToPokt(amount: string | number): number {
  return isNaN(Number(amount)) ? 0 : Number(amount) / UPOKT_CONSTANT;
}

export function toDateFormat(value: Date | null) {
    return value
        ? value.toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).replace(",", "")
        : "N/A";
}
