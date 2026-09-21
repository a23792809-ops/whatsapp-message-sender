import "dotenv/config";
import "temporal-polyfill/global";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const contractJson = JSON.parse(
  readFileSync(join(__dirname, "contract.json"), "utf-8"),
) as unknown as Contract;

export const db = postgres<Contract>({
  contractJson,
  url: process.env["DATABASE_URL"]!,
});
